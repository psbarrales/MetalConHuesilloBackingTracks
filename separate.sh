#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: ./separate.sh <slug>" >&2
  exit 1
fi

slug="$1"
repo_root="$(cd "$(dirname "$0")" && pwd)"
song_dir="$repo_root/public/audio/$slug"
raw_file="$song_dir/raw.mp3"
zip_file="$song_dir/separated.zip"
temp_dir="$song_dir/.separation-tmp"
metadata_file="$song_dir/song.json"
service_url="${STEM_SPLITTER_URL:-http://localhost:4000}"

cleanup_tmp() {
  rm -f "$zip_file"
  rm -rf "$temp_dir"
}

trap cleanup_tmp EXIT

if [[ ! -d "$song_dir" ]]; then
  echo "No existe la carpeta de la canción: $song_dir" >&2
  exit 1
fi

if [[ ! -f "$raw_file" ]]; then
  echo "No existe $raw_file" >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "curl no está instalado" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip no está instalado" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker no está instalado" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 no está instalado" >&2; exit 1; }

echo "Levantando servicio de separación..."
docker compose up -d --build backing-tracking-stemsplitter >/dev/null

echo "Esperando healthcheck del separador..."
for _ in {1..60}; do
  if curl --silent --fail "$service_url/health" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl --silent --fail "$service_url/health" >/dev/null; then
  echo "El separador no respondió en $service_url/health" >&2
  exit 1
fi

rm -rf "$song_dir/unzipped" "$temp_dir"
mkdir -p "$temp_dir"

echo "Leyendo metadata del raw.mp3..."
metadata_json="$(curl --fail --silent --show-error \
  -X POST \
  -F "file=@$raw_file" \
  "$service_url/metadata")"

echo "Subiendo $raw_file para separación..."
curl --fail --silent --show-error \
  -X POST \
  -F "file=@$raw_file" \
  "$service_url/separate" \
  -o "$zip_file"

echo "Descomprimiendo resultados..."
unzip -oq "$zip_file" -d "$temp_dir"

map_stem() {
  local source_name="$1"
  local target_name="$2"
  local source_file

  source_file="$(find "$temp_dir" -type f \( -name "$source_name.mp3" -o -name "$source_name.wav" \) | head -n 1 || true)"
  if [[ -n "$source_file" ]]; then
    cp "$source_file" "$song_dir/$target_name.mp3"
  fi
}

map_stem vocals voz
map_stem bass bajo
map_stem drums bateria
map_stem other guitarra

python3 - "$slug" "$metadata_file" "$metadata_json" <<'PY'
import json
import sys

slug = sys.argv[1]
metadata_path = sys.argv[2]
metadata = json.loads(sys.argv[3]) if sys.argv[3] else {}

def humanize_slug(value):
  return " ".join(part.capitalize() for part in value.replace("_", "-").split("-") if part)

song_json = {
  "id": f"song:{slug}",
  "slug": slug,
  "title": metadata.get("title") or humanize_slug(slug),
  "artist": metadata.get("artist") or "",
  "tempo": metadata.get("tempo"),
  "tracks": ["voz", "guitarra", "bajo", "bateria"],
  "sourceTracks": ["vocals.mp3", "bass.mp3", "drums.mp3", "other.mp3"],
}

with open(metadata_path, "w", encoding="utf-8") as file_handle:
  json.dump(song_json, file_handle, ensure_ascii=False, indent=2)
  file_handle.write("\n")
PY

echo "Stems copiados a $song_dir"
echo "Metadata guardada en $metadata_file"