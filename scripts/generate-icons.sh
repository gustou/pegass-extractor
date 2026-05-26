#!/usr/bin/env bash
# Génère les PNG à partir des SVG (Chrome exige des PNG pour la barre d'outils).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/icons/icon-96.svg"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert introuvable (paquet librsvg)." >&2
  exit 1
fi

for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" "$SRC" -o "${ROOT}/icons/icon-${size}.png"
  echo "icons/icon-${size}.png"
done
