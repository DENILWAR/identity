#!/usr/bin/env bash
# ============================================================
# extract-frames.sh
# Converts scroll.mp4 → optimized WebP frames for scroll animation
#
# Usage:
#   bash extract-frames.sh          → standard frames/ (1× displays)
#   bash extract-frames.sh --hq     → frames-hq/ (Retina/2× displays)
#
# DPR routing (script-scroll.js handles automatically):
#   DPR = 1   → loads frames/
#   DPR > 1   → probes frames-hq/; falls back to frames/ if absent
# ============================================================
set -euo pipefail

VIDEO="img/scroll.mp4"
TARGET_FRAMES=100

# ── Parse flags ────────────────────────────────────────────
HQ=false
for arg in "$@"; do
  [[ "$arg" == "--hq" ]] && HQ=true
done

if $HQ; then
  OUT_DIR="frames-hq"
  QUALITY=92          # Higher quality for Retina compression
  WIDTH=1280          # Source is 1280px — upscaling adds no real detail
  MODE_LABEL="HQ (Retina, quality=92)"
else
  OUT_DIR="frames"
  QUALITY=82          # Standard quality balances size/sharpness for 1× displays
  WIDTH=1280
  MODE_LABEL="Standard (1×, quality=82)"
fi

# ── Check dependencies ─────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "❌  ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -f "$VIDEO" ]; then
  echo "❌  Video not found at $VIDEO"
  exit 1
fi

# ── Get video info ─────────────────────────────────────────
DURATION=$(ffprobe -v error \
  -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 \
  "$VIDEO")

NATIVE_W=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width \
  -of default=noprint_wrappers=1:nokey=1 \
  "$VIDEO")

echo "📹  Video: $VIDEO  (native ${NATIVE_W}px wide)"
echo "⏱   Duration: ${DURATION}s"
echo "🎯  Mode: ${MODE_LABEL}"
echo "🎞   Extracting ${TARGET_FRAMES} frames at ${WIDTH}px wide → ${OUT_DIR}/"
echo ""

# ── Warn if upscaling ──────────────────────────────────────
if [ "$WIDTH" -gt "$NATIVE_W" ] 2>/dev/null; then
  echo "⚠️   Width ${WIDTH}px > source ${NATIVE_W}px — upscaling adds no real detail."
  echo "     Consider using source width. Continuing anyway…"
  echo ""
fi

# ── Create output directory ────────────────────────────────
mkdir -p "$OUT_DIR"

# ── Calculate fps to hit the target frame count ───────────
FPS=$(echo "scale=6; $TARGET_FRAMES / $DURATION" | bc)
echo "📊  Effective fps: $FPS"

# ── Extract frames ─────────────────────────────────────────
# -vf: scale to width (keep aspect ratio, even height for codec compat)
# -compression_level 5: slightly higher compression for better size/quality
# -q:v: WebP quality (maps to 0–100 via libwebp)
ffmpeg -y \
  -i "$VIDEO" \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -c:v libwebp \
  -compression_level 5 \
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
  echo "👉  Set CONFIG.frameCount = ${ACTUAL} in script-scroll.js"
  if $HQ; then
    echo "    HQ frames are served automatically on Retina (DPR > 1) if frames-hq/ exists."
    echo "    Run 'bash extract-frames.sh' (no flag) to also generate standard frames/."
  fi
fi
