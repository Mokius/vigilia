#!/usr/bin/env bash
# Converts the Mixamo FBX drops into game-ready GLBs (one per character, all
# animations from assets/mixamo/raw/anims embedded). See docs/MIXAMO_INGESTA.md
set -u
cd "$(dirname "$0")/.." || exit 1

BL=""
for c in "/c/Program Files/Blender Foundation/Blender 4.5/blender.exe" \
         "/c/Program Files/Blender Foundation/Blender 5.0/blender.exe" \
         "$(command -v blender 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && BL="$c" && break
done
[ -z "$BL" ] && { echo "!! Blender not found"; exit 1; }
echo "using: $BL"

RAW=assets/mixamo/raw
ANIMS="$RAW/anims"
[ -d "$ANIMS" ] || { echo "!! missing $ANIMS (see docs/MIXAMO_INGESTA.md)"; ANIMS=""; }

# name:height
for spec in "romero:1.85" "parasite:1.50" "drake:1.90"; do
  n="${spec%%:*}"; h="${spec##*:}"
  src="$RAW/$n.fbx"
  if [ ! -f "$src" ]; then echo "-- skip $n (no $src)"; continue; fi
  echo ""; echo "=== building $n (height ${h}m) ==="
  args=(--char "$src" --out "assets/models/$n.glb" --height "$h")
  [ -n "$ANIMS" ] && args+=(--anims "$ANIMS")
  "$BL" -b -P tools/mixamo_to_glb.py -- "${args[@]}" 2>&1 \
    | grep -E "^==|^   \+|^   !|^!!|Error|Traceback" || true
done

echo ""; echo "=== result ==="
ls -la assets/models/*.glb 2>/dev/null || echo "(nothing produced)"
