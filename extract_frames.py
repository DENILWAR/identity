"""
extract_frames.py
Extracts optimized WebP frames from scroll.mp4 using imageio-ffmpeg.
Targets 100 frames at 1280px wide.
"""
import os
import sys
import numpy as np

# imageio_ffmpeg ships its own ffmpeg binary — no compilation needed
import imageio_ffmpeg
from PIL import Image

VIDEO_PATH    = "img/scroll.mp4"
OUT_DIR       = "frames"
TARGET_FRAMES = 100
TARGET_WIDTH  = 1280
WEBP_QUALITY  = 82   # 0–100

def main():
    if not os.path.exists(VIDEO_PATH):
        print(f"❌  Video not found: {VIDEO_PATH}")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    print(f"🔧  Using bundled ffmpeg: {ffmpeg_exe}")

    # ── Open video reader ───────────────────────────────────
    # imageio_ffmpeg.read_frames yields (meta_dict) then raw bytes per frame
    reader   = imageio_ffmpeg.read_frames(VIDEO_PATH)
    meta     = next(reader)          # first yield = metadata dict
    fps_raw  = meta.get("fps", 30)
    size     = meta.get("size", (1920, 1080))  # (w, h)
    duration = meta.get("duration", None)
    n_frames = meta.get("nframes", None)

    print(f"📹  {size[0]}×{size[1]}px  |  FPS: {fps_raw}  |  Duration: {duration}s  |  Frames: {n_frames}")

    # ── Read all frames via ffmpeg pipe ─────────────────────
    print(f"⏳  Decoding all frames into memory…")

    all_frames = []
    bytes_per_frame = size[0] * size[1] * 3  # RGB
    for raw in reader:
        # raw is bytes; reshape to numpy array
        arr = np.frombuffer(raw, dtype=np.uint8).reshape((size[1], size[0], 3))
        all_frames.append(arr)

    total_raw = len(all_frames)
    print(f"🎞   Total raw frames: {total_raw}")

    if total_raw == 0:
        print("❌  No frames read from video.")
        sys.exit(1)

    # ── Sample evenly to hit TARGET_FRAMES ──────────────────
    if total_raw <= TARGET_FRAMES:
        indices = list(range(total_raw))
    else:
        step = total_raw / TARGET_FRAMES
        indices = [int(round(i * step)) for i in range(TARGET_FRAMES)]
        # Clamp to valid range
        indices = [min(i, total_raw - 1) for i in indices]

    actual_count = len(indices)
    print(f"✂️   Sampling {actual_count} frames evenly from {total_raw}")

    # ── Export as WebP ───────────────────────────────────────
    print(f"💾  Exporting to {OUT_DIR}/ at {TARGET_WIDTH}px wide, quality={WEBP_QUALITY}…")

    for out_idx, src_idx in enumerate(indices):
        frame_num = out_idx + 1
        out_path = os.path.join(OUT_DIR, f"frame_{frame_num:04d}.webp")

        # Convert numpy array to PIL Image
        img = Image.fromarray(all_frames[src_idx])

        # Resize — maintain aspect ratio
        orig_w, orig_h = img.size
        if orig_w != TARGET_WIDTH:
            ratio  = TARGET_WIDTH / orig_w
            new_h  = int(orig_h * ratio)
            img    = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)

        img.save(out_path, "WEBP", quality=WEBP_QUALITY, method=4)

        # Progress indicator
        if frame_num % 10 == 0 or frame_num == actual_count:
            pct = frame_num / actual_count * 100
            bar = "█" * int(pct // 5) + "░" * (20 - int(pct // 5))
            print(f"  [{bar}] {pct:.0f}%  ({frame_num}/{actual_count})", end="\r", flush=True)

    print()  # newline after progress bar

    # ── Report ───────────────────────────────────────────────
    files = sorted(f for f in os.listdir(OUT_DIR) if f.endswith(".webp"))
    total_bytes = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in files)
    total_mb = total_bytes / 1024 / 1024

    # Check actual dimensions of first frame
    first = Image.open(os.path.join(OUT_DIR, files[0]))
    w, h = first.size

    print(f"\n✅  Done!")
    print(f"📐  Frame size:   {w} × {h}px")
    print(f"🎞   Frame count: {len(files)}")
    print(f"💾  Total size:   {total_mb:.1f} MB")
    print(f"\n👉  Open scroll.html in your browser.")
    print(f"    Tip: set CONFIG.frameCount = {len(files)} in script-scroll.js")
    print(f"         for faster startup (skips auto-detection).")

if __name__ == "__main__":
    # Change to project root so relative paths work
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    main()
