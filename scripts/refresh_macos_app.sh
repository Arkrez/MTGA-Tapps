#!/usr/bin/env bash
# Rebuild Tapps Tracker from this checkout and replace the copy in
# /Applications, then start it again. For running your own latest code on
# this Mac; releases still go through scripts/build_macos_installer.sh / CI.
#
#   scripts/refresh_macos_app.sh            build the current branch, install, launch
#   scripts/refresh_macos_app.sh --pull     git pull first
#   scripts/refresh_macos_app.sh --fast     reuse the build environment (quicker)
#   scripts/refresh_macos_app.sh --no-launch
#
# Quits the running tracker first: do not run it in the middle of a match.
# Your games, drafts and settings live in ~/Library/Application Support/MTGA
# Tracker and are not touched. The replaced app is kept in
# build/previous-app/ so you can move it back.
#
# Without a Rust toolchain the in-game overlay cannot be built; the overlay
# from the installed app is reused instead (install Rust from https://rustup.rs
# to build it from source).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="MTGA Tracker.app"
INSTALLED="/Applications/$APP_NAME"
BUNDLE_ID="com.travispatton.mtgatracker"
BACKUP_DIR="$ROOT_DIR/build/previous-app"
DASHBOARD_URL="http://127.0.0.1:8765"

PULL=0
FAST=0
LAUNCH=1
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --fast) FAST=1 ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

cd "$ROOT_DIR"
step() { printf '\n==> %s\n' "$1"; }

if [[ "$PULL" == "1" ]]; then
  step "Updating $(git branch --show-current) from GitHub"
  git pull --ff-only
fi
echo "Building $(git branch --show-current) @ $(git rev-parse --short HEAD)"

# The released app ships Python 3.12; build with it when Homebrew has it.
VENV="$ROOT_DIR/build/venv-py312"
if [[ ! -x "$VENV/bin/python" ]]; then
  BASE_PYTHON="$(command -v python3.12 || command -v python3)"
  step "Creating build environment with $("$BASE_PYTHON" --version)"
  "$BASE_PYTHON" -m venv "$VENV"
fi

OVERLAY_OUT="$ROOT_DIR/overlay/build-out"
REUSED_OVERLAY=0
if ! command -v cargo >/dev/null 2>&1 && [[ ! -d "$OVERLAY_OUT/Tapps Overlay.app" ]]; then
  if [[ -d "$INSTALLED/Contents/Helpers/Tapps Overlay.app" ]]; then
    step "No Rust toolchain: reusing the installed overlay"
    mkdir -p "$OVERLAY_OUT"
    cp -R "$INSTALLED/Contents/Helpers/Tapps Overlay.app" "$OVERLAY_OUT/"
    REUSED_OVERLAY=1
  else
    echo "!! No Rust toolchain and no installed overlay: the new app will have no in-game overlay"
  fi
fi
cleanup() { [[ "$REUSED_OVERLAY" == "1" ]] && rm -rf "$OVERLAY_OUT"; return 0; }
trap cleanup EXIT

step "Building the app (this takes a few minutes)"
LOG="$ROOT_DIR/build/refresh-app.log"
mkdir -p "$ROOT_DIR/build"
BUILD_ARGS=()
[[ "$FAST" == "1" ]] && BUILD_ARGS+=(--fast)
if ! PYTHON="$VENV/bin/python" "$ROOT_DIR/scripts/build_macos_app.sh" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} >"$LOG" 2>&1; then
  tail -30 "$LOG"
  echo "!! Build failed; the installed app was not changed. Full log: $LOG" >&2
  exit 1
fi
NEW_APP="$ROOT_DIR/dist/$APP_NAME"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEW_APP/Contents/Info.plist")"
echo "Built $VERSION"

if pgrep -f "$INSTALLED/Contents/MacOS" >/dev/null; then
  step "Quitting the running tracker"
  osascript -e "quit app id \"$BUNDLE_ID\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$INSTALLED/Contents/MacOS" >/dev/null || break
    sleep 1
  done
  if pgrep -f "$INSTALLED/Contents/MacOS" >/dev/null; then
    echo "!! The tracker did not quit. Quit it from its menu-bar icon and run this again." >&2
    exit 1
  fi
fi

step "Installing into /Applications"
if [[ -d "$INSTALLED" ]]; then
  mkdir -p "$BACKUP_DIR"
  rm -rf "$BACKUP_DIR/MTGA Tracker (previous).app"
  mv "$INSTALLED" "$BACKUP_DIR/MTGA Tracker (previous).app"
  echo "Previous app kept at $BACKUP_DIR/MTGA Tracker (previous).app"
fi
ditto "$NEW_APP" "$INSTALLED"
codesign --verify --deep --strict "$INSTALLED"

if [[ "$LAUNCH" == "1" ]]; then
  step "Starting Tapps Tracker"
  open "$INSTALLED"
  # While the database is being upgraded the app serves a "starting" page for
  # every path, so wait for the real JSON answer.
  for _ in $(seq 1 90); do
    ANSWER="$(curl -fs --max-time 2 "$DASHBOARD_URL/api/version" || true)"
    if [[ "$ANSWER" == \{\"version\"* ]]; then
      echo "Running $ANSWER — dashboard at $DASHBOARD_URL"
      exit 0
    fi
    sleep 1
  done
  echo "!! Installed $VERSION, but the dashboard did not answer yet. Check the menu-bar icon." >&2
  exit 1
fi
echo "Installed $VERSION (not started)."
