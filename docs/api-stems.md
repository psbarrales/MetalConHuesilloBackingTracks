# API — separación de stems, canciones custom, checkpoints y MIDI

Servicio Flask en `tools/stemsplitter/app.py`, expuesto en `:4000` (Docker/compose). Dependencias (`requirements.txt`): `demucs==4.0.1`, `Flask==3.0.3`, `Flask-Cors==5.0.0`, `mutagen==1.47.0`. Requiere `ffmpeg` en la imagen.

## Configuración vía entorno

| Variable | Default | Uso |
|---|---|---|
| `CUSTOM_SONGS_ROOT` | `<app>/custom-songs` | Raíz de canciones custom (en Docker: `/data/custom-songs`) |
| `APP_DB_PATH` | `<custom_songs_root>/../app.db` | Archivo SQLite (en Docker: `/data/app.db`) |
| `MAX_UPLOAD_BYTES` | 200 MB | Límite de subida (413 si se excede) |
| `DEMUCS_MODEL` | `htdemucs` | Modelo de Demucs |
| `DEMUCS_MP3_BITRATE` | `320` | Bitrate de los stems mp3 generados |

## Validación de archivos (seguridad)

- **Magic bytes** (`detect_upload_type`): bloquea HTML/JS camuflados (`<html`, `<!doctype html`, `<script`, `<?xml`, `javascript:`) y detecta el tipo real del contenido: `mp3` (ID3 o sync `0xFF Ex`), `wav` (RIFF/WAVE), `ogg` (OggS), `flac` (fLaC), `png/jpg/webp` para portadas.
- La extensión declarada debe coincidir con el tipo detectado → si no, `400 "Invalid or unsafe audio content"`.
- `secure_filename` de Werkzeug para nombres; `X-Content-Type-Options: nosniff` en todas las respuestas.

## Endpoints

### Utilidades

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Healthcheck (`{"status":"ok"}`) |
| POST | `/metadata` | Multipart `file` → lee tags ID3 (mutagen easy): `{title, artist, tempo}` |
| POST | `/separate` | Multipart `file` → separa con Demucs y responde un **zip** con los stems. Síncrono (puede tardar minutos) |

### Canciones custom

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/songs/custom` | Catálogo: lee `song.json` de cada subcarpeta, responde `{songs: [...]}` con `baseUrl` absoluta y `custom: true` |
| POST | `/songs/custom` | Multipart (`file` obligatorio; `title`, `artist`, `tempo` opcionales). Crea la entrada con `status: processing` y **separa en background** (thread daemon). Respuesta `201 {song}` |
| POST | `/songs/custom/manual` | Multipart: `title` obligatorio + stems `voz`, `guitarra`, `bajo`, `bateria` (todos obligatorios), opcionales `artist`, `tempo`, `cover`. `201` con `status: ready`, `createdBy: manual` |
| PATCH | `/songs/custom/{slug}` | Multipart. Edita `title`/`artist`/`tempo`; opcional `cover`, stems individuales, o `raw` (nuevo master → vuelve a separar en background, `status: processing`) |
| DELETE | `/songs/custom/{slug}` | Borra la carpeta de la canción (204) |
| GET | `/songs/custom/{slug}/status` | `{song}` con `status`: `processing` \| `ready` \| `error` (+ `error` mensaje) |
| GET | `/songs/custom/{slug}/song.json` | Manifiesto de la canción |
| GET | `/songs/custom/{slug}/{archivo}` | Sirve archivos generados (`voz.mp3`, `portada.png`, `raw.mp3`, …) |

Formato de una canción custom en respuestas:

```json
{
  "id": "custom:{slug}",
  "slug": "mi-cancion",
  "title": "Mi Canción",
  "artist": "Banda",
  "tempo": 140,
  "tracks": ["voz", "guitarra", "bajo", "bateria"],
  "sourceTracks": ["vocals.mp3", "bass.mp3", "drums.mp3", "other.mp3"],
  "status": "ready",
  "error": null,
  "custom": true,
  "baseUrl": "http://host/songs/custom/mi-cancion"
}
```

### Checkpoints y MIDI (SQLite)

Esquema (`init_db`, `PRAGMA foreign_keys = ON`):

- `song_midi_controls(song_slug PK, next_cc, prev_cc)` — defaults 21/22.
- `checkpoint_groups(id, song_slug, name, sort_order)` — índice por `(song_slug, sort_order, id)`.
- `checkpoints(id, group_id FK → checkpoint_groups ON DELETE CASCADE, label, time_seconds, sort_order)` — índice por `(group_id, sort_order, time_seconds, id)`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/songs/{slug}/checkpoints` | Payload completo: `{songSlug, midi: {nextCc, prevCc}, groups: [{id, name, sortOrder, checkpoints: [{id, label, time, sortOrder}]}]}` |
| PATCH | `/songs/{slug}/midi-controls` | JSON `{nextCc?, prevCc?}` → upsert (CC clamped 0–127). Devuelve el payload completo |
| POST | `/songs/{slug}/checkpoint-groups` | JSON `{name, sortOrder?}` → `201 {group}` |
| PATCH | `/checkpoint-groups/{id}` | JSON `{name?, sortOrder?}` → payload completo |
| DELETE | `/checkpoint-groups/{id}` | 204 (borra checkpoints en cascada) |
| POST | `/checkpoint-groups/{id}/checkpoints` | JSON `{label, time, sortOrder?}` → `201 {checkpoint}` |
| PATCH | `/checkpoints/{id}` | JSON `{label?, time?, sortOrder?, groupId?}` → payload completo (valida que el grupo pertenezca a la misma canción) |
| DELETE | `/checkpoints/{id}` | 204 |

Coerciones: tiempos ≥ 0 (`coerce_checkpoint_time`), `sortOrder` entero (default 0), CC 0–127 (`coerce_midi_cc`).

## Pipeline de separación (background)

`process_custom_song(song_dir, source_path, song)`:

1. `demucs.separate -n htdemucs -o {tmp} --mp3 --mp3-bitrate=320 {raw}`.
2. Mapea con `CUSTOM_TRACK_MAP`: `vocals → voz`, `bass → bajo`, `drums → bateria`, `other → guitarra` (busca `.mp3` y luego `.wav` en la salida) y copia como `{target}.mp3` a la carpeta de la canción.
3. Actualiza `song.json`: `status: ready`, `tracks`, `sourceTracks`; en error: `status: error` + mensaje. Limpia el directorio temporal de Demucs siempre.
4. El thread es daemon: si el proceso muere, la canción queda en `processing` (la UI seguirá consultando).

**Nota importante:** `other` es el instrumental restante que devuelve Demucs, **no** guitarra pura.

## Flujo del frontend contra la API

`inMemorySongRepository.js`:

- `listSongs()` = estáticas (glob) + `fetchCustomSongs()` (solo `status === 'ready'`), ordenadas por título.
- `requestJson()` centraliza fetch + manejo de errores; si la API no responde: "API no disponible en {url}. Levanta o reconstruye el servicio API."
- La UI hace polling de status cada 3,5 s mientras `customSongStatus.type === 'processing'` y auto-selecciona la canción al quedar `ready`.
