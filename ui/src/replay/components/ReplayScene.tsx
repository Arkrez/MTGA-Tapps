/**
 * The WebGL table (React Three Fiber, demand-driven frame loop) plus its DOM
 * overlays: projected labels, targeting arrows (SVG) and the stack preview.
 * Measures the stage so the table's width can follow its aspect.
 */
import { Canvas } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardPlacement, Layout } from '../layout';
import type { ReplayPrefs } from '../prefs';
import type { BoardState } from '../reducer';
import { sceneArrows, sleeveNeon } from '../scene/arrows';
import { DEFAULT_MARGINS, fitTableForView } from '../scene/cameraFit';
import type { TableFit } from '../scene/cameraFit';
import type { HoverStore } from '../scene/hoverStore';
import { createSceneKit } from '../scene/kit';
import { sceneLabels } from '../scene/labels';
import { MotionRegistry } from '../scene/motionRegistry';
import { isUnknownCard } from '../scene/textureStore';
import type { TextureStore } from '../scene/textureStore';
import type { CardKey, ReplayCard } from '../types';
import type { CardHandlers } from './CardMesh';
import { SceneContents } from './SceneContents';
import { StackPreview } from './StackPreview';

export interface ReplaySceneProps {
  layout: Layout;
  state: BoardState;
  prefs: ReplayPrefs;
  cards: Readonly<Record<CardKey, ReplayCard>>;
  store: TextureStore;
  hover: HoverStore;
  /** True after a seek jump: cards move instantly instead of animating. */
  snap: boolean;
  /** Playback is running (paused: a resolved stack item is held on screen). */
  playing: boolean;
  onCardClick: (card: CardKey) => void;
  /** Reports the felt width and hand scale that fill the measured stage (see fitTableForView). */
  onTableFit?: (fit: TableFit) => void;
}

const GL_OPTIONS = { antialias: true, powerPreference: 'high-performance' } as const;
const DPR: [number, number] = [1, 2];

function sceneKey(placement: CardPlacement): string {
  return `scene:${placement.obj}`;
}

function ReplaySceneImpl({
  layout,
  state,
  prefs,
  cards,
  store,
  hover,
  snap,
  playing,
  onCardClick,
  onTableFit,
}: ReplaySceneProps) {
  const [registry] = useState(() => new MotionRegistry());
  const [stackNodes] = useState(() => new Map<string, HTMLElement>());
  const kit = useMemo(() => createSceneKit(store), [store]);
  useEffect(() => () => kit.dispose(), [kit]);
  const labels = useMemo(() => sceneLabels(layout, cards), [layout, cards]);
  const arrows = useMemo(() => sceneArrows(state, layout), [state, layout]);
  const labelRoot = useRef<HTMLDivElement>(null);
  const arrowRoot = useRef<SVGGElement>(null);
  const stackRoot = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const click = useRef(onCardClick);
  useEffect(() => {
    click.current = onCardClick;
  }, [onCardClick]);
  const stableClick = useMemo(() => (card: CardKey) => click.current(card), []);

  // The felt and the hands follow the stage aspect: measure the stage, report the fit.
  const preset = prefs.camera;
  useEffect(() => {
    const node = wrap.current;
    if (!node || !onTableFit || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) onTableFit(fitTableForView({ width, height }, DEFAULT_MARGINS, preset));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onTableFit, preset]);

  const handlers = useMemo<CardHandlers>(() => {
    const inspectable = (p: CardPlacement) => p.faceUp && p.card !== null && !isUnknownCard(p.card, cards[p.card]);
    return {
      over(p, x, y) {
        if (!inspectable(p) || !p.card) {
          hover.clear(sceneKey(p));
          return;
        }
        hover.set({ key: sceneKey(p), card: p.card, name: cards[p.card]?.name ?? '', x, y, source: 'scene' });
      },
      out(p) {
        hover.clear(sceneKey(p));
      },
      click(p) {
        if (inspectable(p) && p.card) click.current(p.card);
      },
    };
  }, [cards, hover]);

  useEffect(
    () =>
      hover.subscribe(() => {
        if (wrap.current) wrap.current.style.cursor = hover.get()?.source === 'scene' ? 'pointer' : '';
      }),
    [hover],
  );

  const colors = useMemo(
    () => ({ player: sleeveNeon(prefs.playerSleeve), opponent: sleeveNeon(prefs.opponentSleeve) }),
    [prefs.playerSleeve, prefs.opponentSleeve],
  );

  return (
    <div
      className="replay-canvas-wrap"
      ref={wrap}
      onPointerLeave={() => {
        if (hover.get()?.source === 'scene') hover.set(null);
      }}
    >
      <Canvas
        className="replay-canvas"
        frameloop="demand"
        dpr={DPR}
        gl={GL_OPTIONS}
        flat
        onPointerMissed={() => hover.set(null)}
      >
        <SceneContents
          layout={layout}
          state={state}
          prefs={prefs}
          cards={cards}
          store={store}
          kit={kit}
          registry={registry}
          labels={labels}
          labelRoot={labelRoot}
          arrows={arrows}
          arrowRoot={arrowRoot}
          stackRoot={stackRoot}
          stackNodes={stackNodes}
          handlers={handlers}
          snap={snap}
        />
      </Canvas>
      <div className="replay-labels" ref={labelRoot} aria-hidden="true">
        {labels.map((label) => (
          <span key={label.id} className={`replay-label replay-label-${label.tone}${label.emphasis ? ' replay-label-emphasis' : ''}`}>
            {label.text}
          </span>
        ))}
      </div>
      <svg className={`replay-arrows${snap ? ' replay-arrows-snap' : ''}`} aria-hidden="true">
        <defs>
          <filter id="replay-arrow-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g ref={arrowRoot}>
          {arrows.map((arrow) => {
            const neon = arrow.seat === state.playerSeat ? colors.player : colors.opponent;
            return (
              <g
                key={arrow.id}
                className={`replay-arrow replay-arrow-${arrow.tone}`}
                data-arrow={arrow.id}
                visibility="hidden"
                style={{ '--arrow-glow': neon.glow, '--arrow-core': neon.core } as CSSProperties}
              >
                <path data-part="glow" className="replay-arrow-glow" filter="url(#replay-arrow-blur)" />
                <path data-part="core" className="replay-arrow-core" />
                <path data-part="flow" className="replay-arrow-flow" />
                <polygon data-part="head" className="replay-arrow-head" />
                {arrow.to.kind === 'seat' ? <circle data-part="reticle" className="replay-arrow-reticle" r="9" /> : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="replay-stack-layer" ref={stackRoot}>
        <StackPreview
          state={state}
          playerSeat={state.playerSeat}
          store={store}
          snap={snap}
          playing={playing}
          nodes={stackNodes}
          onCardClick={stableClick}
        />
      </div>
    </div>
  );
}

export const ReplayScene = memo(ReplaySceneImpl);
export default ReplayScene;
