#!/usr/bin/env bash
# ============================================================
# extract-frames.sh
# Converts scroll.mp4 → optimized WebP frames for scroll animation
# Usage: bash extract-frames.sh
# ============================================================
set -euo pipefail

VIDEO="img/scroll.mp4"
OUT_DIR="frames"
TARGET_FRAMES=100      # How many frames to extract (80–120 range)
WIDTH=1280             # Output width (height auto-calculated)
QUALITY=82             # WebP quality 0–100 (82 = great balance)

# ── Check dependencies ─────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "❌  ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -f "$VIDEO" ]; then
  echo "❌  Video not found at $VIDEO"
  exit 1
fi

# ── Get video duration ─────────────────────────────────────
DURATION=$(ffprobe -v error \
  -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  "$VIDEO")

echo "📹  Video: $VIDEO"
echo "⏱   Duration: ${DURATION}s"
echo "🎞   Extracting ${TARGET_FRAMES} frames at ${WIDTH}px wide..."

# ── Create output directory ────────────────────────────────
mkdir -p "$OUT_DIR"

# ── Calculate fps to hit the target frame count ───────────
# fps = TARGET_FRAMES / DURATION
FPS=$(echo "scale=6; $TARGET_FRAMES / $DURATION" | bc)
echo "📊  Effective fps: $FPS"

# ── Extract frames ─────────────────────────────────────────
# -vf: scale to width (keep aspect), then crop to exact even dimensions
# -compression_level 4: faster WebP encoding with good compression
# -q:v: WebP quality (maps to 0–100 via libwebp)
ffmpeg -y \
  -i "$VIDEO" \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -c:v libwebp \
  -compression_level 4 \
  -quality ${QUALITY} \
  -an \
  -vsync vfr \
  "${OUT_DIR}/frame_%04d.webp" \
  2>&1 | grep --line-buffered -E "(frame|fps|time|error|warning)" || true

# ── Count actual output ────────────────────────────────────
ACTUAL=$(ls "$OUT_DIR"/frame_*.webp 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "✅  Done! ${ACTUAL} frames extracted to ./${OUT_DIR}/"

# ── Report sizes ───────────────────────────────────────────
if [ "$ACTUAL" -gt 0 ]; then
  TOTAL_SIZE=$(du -sh "$OUT_DIR" | cut -f1)
  FIRST_FILE=$(ls "$OUT_DIR"/frame_*.webp | head -1)
  DIMS=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$FIRST_FILE" 2>/dev/null || echo "unknown")
  echo "📐  Frame dimensions: ${DIMS}px"
  echo "💾  Total size: ${TOTAL_SIZE}"
  echo ""
  echo "👉  Open scroll.html in your browser to preview!"
  echo "   Tip: update CONFIG.frameCount = ${ACTUAL} in script-scroll.js"
  echo "        to skip auto-detection and load faster."
fi
