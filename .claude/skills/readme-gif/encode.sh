#!/usr/bin/env bash
# Decode captured frames (JSON of base64 PNGs) and encode a looping GIF.
# Usage: encode.sh <frames.json> <out.gif> [fps] [size]
set -euo pipefail
FRAMES_JSON="${1:?path to frames.json}"
OUT_GIF="${2:?output gif path}"
FPS="${3:-18}"
SIZE="${4:-380}"
COLORS="${COLORS:-40}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FRAMES_JSON="$FRAMES_JSON" WORK="$WORK" bun -e '
const data = await Bun.file(process.env.FRAMES_JSON).json();
let i = 0;
for (const b64 of data.frames) {
  await Bun.write(`${process.env.WORK}/f${String(i).padStart(3,"0")}.png`, Buffer.from(b64, "base64"));
  i++;
}
console.log(`decoded ${i} frames @ ${data.w}x${data.h}`);
'

# Source PNGs are 24fps cadence; `fps=` decimates to the target rate. Two-pass
# palette (stats_mode=diff) + light bayer dither keeps color clean and small.
ffmpeg -y -framerate 24 -i "$WORK/f%03d.png" \
  -vf "fps=${FPS},scale=${SIZE}:${SIZE}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${COLORS}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 "$OUT_GIF"

ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames \
  -of default=noprint_wrappers=1 "$OUT_GIF"
echo "wrote $OUT_GIF ($(du -h "$OUT_GIF" | cut -f1))"
