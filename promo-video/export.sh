#!/usr/bin/env bash
# Relance tous les exports : bande son, MP4 Reels, MP4 TikTok, couverture.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 promo-video/audio.py
node promo-video/render.mjs
node promo-video/cover.mjs
for f in instagram-reels tiktok; do
  ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of csv=p=0 "promo-video/$f.mp4"
done
