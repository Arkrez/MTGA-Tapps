/**
 * MP4 encoding in the browser: WebCodecs `VideoEncoder` (H.264 when the
 * browser offers it, else VP9) muxed into a fast-start MP4 by mp4-muxer.
 * Frames are pushed one canvas at a time with explicit timestamps, so the
 * export can run faster than real time. Nothing leaves the machine.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export type VideoQuality = 'small' | 'balanced' | 'best';

export interface Mp4EncoderOptions {
  width: number;
  height: number;
  fps: number;
  /** Target bitrate class; 'balanced' when omitted. */
  quality?: VideoQuality;
}

export interface Mp4Encoder {
  /** Codec string actually in use (for the done message). */
  readonly codec: string;
  /** Encodes one frame; resolves once the encoder has room for the next. */
  addFrame(source: CanvasImageSource, index: number): Promise<void>;
  /** Flushes and muxes; resolves with the MP4. */
  finish(): Promise<Blob>;
  /** Drops everything encoded so far. */
  cancel(): void;
}

/** The browser can encode video (Chrome, Edge, Safari 16.4+, Firefox 130+). */
export function supportsVideoExport(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** Candidate codecs, best first: H.264 High, Main, Baseline, then VP9 in MP4. */
const CANDIDATES: ReadonlyArray<{ container: 'avc' | 'vp9'; codec: string }> = [
  { container: 'avc', codec: 'avc1.640028' },
  { container: 'avc', codec: 'avc1.4d0028' },
  { container: 'avc', codec: 'avc1.42001f' },
  { container: 'vp9', codec: 'vp09.00.40.08' },
];

/** Bits per pixel per frame and the ceiling for each quality; the table is mostly still, so modest rates look clean. */
const QUALITY: Record<VideoQuality, { bpp: number; cap: number }> = {
  small: { bpp: 0.02, cap: 2_500_000 },
  balanced: { bpp: 0.04, cap: 5_000_000 },
  best: { bpp: 0.09, cap: 12_000_000 },
};

/** Bits per second for a frame size, rate and quality. */
export function bitrateFor(width: number, height: number, fps: number, quality: VideoQuality = 'balanced'): number {
  const { bpp, cap } = QUALITY[quality];
  return Math.min(cap, Math.max(600_000, Math.round(width * height * fps * bpp)));
}

/** Rough file size in bytes for `seconds` of video. */
export function estimateBytes(width: number, height: number, fps: number, quality: VideoQuality, seconds: number): number {
  return Math.round((bitrateFor(width, height, fps, quality) / 8) * seconds);
}

/** Pending encodes allowed before addFrame waits (keeps memory bounded). */
const MAX_QUEUE = 8;
/** An encoder that accepts frames but outputs nothing for this long is treated as stalled. */
const STALL_MS = 20_000;
/** One key frame every two seconds, so seeking in the result is quick. */
const KEYFRAME_SECONDS = 2;

async function pickConfig(opts: Mp4EncoderOptions): Promise<{ container: 'avc' | 'vp9'; config: VideoEncoderConfig }> {
  const bitrate = bitrateFor(opts.width, opts.height, opts.fps, opts.quality ?? 'balanced');
  for (const candidate of CANDIDATES) {
    // No acceleration preference: the browser uses a hardware encoder when it
    // has one and software otherwise (asking for hardware outright can be
    // reported as supported and then never produce a frame).
    const config: VideoEncoderConfig = {
      codec: candidate.codec,
      width: opts.width,
      height: opts.height,
      bitrate,
      framerate: opts.fps,
      latencyMode: 'quality',
      ...(candidate.container === 'avc' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { container: candidate.container, config: support.config ?? config };
    } catch {
      // Try the next codec.
    }
  }
  throw new Error('This browser cannot encode H.264 or VP9 video.');
}

export async function createMp4Encoder(opts: Mp4EncoderOptions): Promise<Mp4Encoder> {
  if (!supportsVideoExport()) throw new Error('Video export needs a browser with WebCodecs.');
  if (opts.width % 2 || opts.height % 2) throw new Error('Video dimensions must be even.');
  const { container, config } = await pickConfig(opts);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: container, width: opts.width, height: opts.height, frameRate: opts.fps },
    fastStart: 'in-memory',
  });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure(config);
  const frameMicros = 1_000_000 / opts.fps;
  const keyEvery = Math.max(1, Math.round(opts.fps * KEYFRAME_SECONDS));
  let closed = false;

  const waitForRoom = async () => {
    const started = performance.now();
    while (encoder.encodeQueueSize > MAX_QUEUE && !failure) {
      if (performance.now() - started > STALL_MS) {
        failure = new Error('The video encoder stopped responding.');
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 4));
    }
  };

  return {
    codec: config.codec,
    async addFrame(source, index) {
      if (failure) throw failure;
      if (closed) throw new Error('Encoder closed.');
      const frame = new VideoFrame(source, {
        timestamp: Math.round(index * frameMicros),
        duration: Math.round(frameMicros),
      });
      try {
        encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      } finally {
        frame.close();
      }
      await waitForRoom();
      if (failure) throw failure;
    },
    async finish() {
      if (closed) throw new Error('Encoder closed.');
      await encoder.flush();
      if (failure) throw failure;
      closed = true;
      encoder.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    cancel() {
      if (closed) return;
      closed = true;
      try {
        encoder.close();
      } catch {
        // Already closed by an error.
      }
    },
  };
}
