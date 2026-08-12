# SKILLS.md — Skills del repositorio Metal Con Huesillo Backing Tracks

Catálogo de procedimientos operativos del proyecto. Cada skill indica **cuándo usarla**, los **pasos exactos** y los **pitfalls** conocidos. Los agentes de IA deben cargar la skill relevante antes de ejecutar la tarea correspondiente.

---

## Skill 1: Agregar una canción estática

**Cuándo:** hay un master (o stems ya separados) y se quiere sumar la canción al catálogo base (`public/audio/`), versionada en git.

**Pasos:**

1. Crear la carpeta `public/audio/{slug}/` con un slug `kebab-case` (ej: `holy_diver`).
2. Colocar los stems con nombres exactos:
   - `voz.mp3`, `guitarra.mp3`, `bajo.mp3`, `bateria.mp3`
   - Opcional: `metronomo.mp3` (si falta, el motor usa el metrónomo sintético), `lyrics.srt`, `portada.png`.
3. Crear `song.json`:
   ```json
   {
     "id": "song:{slug}",
     "slug": "{slug}",
     "title": "Título",
     "artist": "Artista",
     "tempo": 120,
     "tracks": ["voz", "guitarra", "bajo", "bateria"],
     "sourceTracks": ["vocals.mp3", "bass.mp3", "drums.mp3", "other.mp3"]
   }
   ```
   El campo `tempo` es el BPM base; el reproductor lo usa para calcular `playbackRate` (target/base). `tracks` no incluye `metronomo`: `Song.js` lo agrega siempre.
4. La canción aparece automáticamente en el listado (el catálogo se arma con `import.meta.glob` de `public/audio/*/song.json`; `inMemorySongRepository` la ordena por título alfabético).
5. Opcional: el título/artista/BPM pueden venir de la metadata del mp3 (tags ID3, ver Skill 5) en vez de hardcodearlos.

**Pitfalls:**

- `other` de Demucs **no es guitarra pura**: es el instrumental restante. Si el stem de guitarra suena "raro", es esperado.
- El slug no puede repetirse entre estáticas y custom: la API genera `{slug}-2`, `{slug}-3`… solo para custom.
- Si no hay `voz.mp3`, el maestro de sincronía cae al primer track no sintético (`useMultiTrackPlayer.js`), pero la calidad de sincronía depende de que `voz` exista.

---

## Skill 2: Separar un master en stems (pipeline local)

**Cuándo:** se tiene `raw.mp3` de una canción y se quieren los 4 stems + `song.json` en `public/audio/{slug}/`.

**Pasos:**

1. Colocar el master en `public/audio/{slug}/raw.mp3`.
2. Ejecutar `./separate.sh {slug}`.
3. El script:
   - Levanta el contenedor `backing-tracking-stemsplitter` (`docker compose up -d --build`).
   - Espera el healthcheck (`GET /health`).
   - Lee metadata del raw (`POST /metadata`) para title/artist/tempo.
   - Sube el raw y descarga el zip (`POST /separate`).
   - Descomprime y mapea: `vocals→voz`, `bass→bajo`, `drums→bateria`, `other→guitarra`.
   - Genera `song.json` con la metadata (cae al slug humanizado si falta título).
4. Verificar: `ls public/audio/{slug}/` debe tener los 4 mp3 + `song.json`. La carpeta temporal `.separation-tmp` se limpia sola (trap EXIT).

**Pitfalls:**

- Requiere `curl`, `unzip`, `docker` y `python3` instalados.
- Si el separador ya está corriendo con código viejo, rebuild: `docker compose up -d --build backing-tracking-stemsplitter`.
- El primer run de Demucs descarga el modelo `htdemucs` (pesado); requiere red.
- `separate.sh` usa `STEM_SPLITTER_URL` o `http://localhost:4000`.

---

## Skill 3: Agregar / editar una canción custom (vía API/UI)

**Cuándo:** el usuario quiere subir una canción desde la interfaz sin tocar git (ensayos, temas nuevos), o editarla/eliminarla.

**Pasos (UI):** botón **"Agregar canción"** → dos modos:

- **Separar master:** sube el archivo (`POST /songs/custom` con multipart: `file` obligatorio; `title`, `artist`, `tempo` opcionales). La API responde `201` con `status: processing` y separa en **background** (thread daemon + Demucs). La UI hace polling de `GET /songs/custom/{slug}/status` cada 3.5 s hasta `ready` o `error`, y auto-selecciona la canción al terminar.
- **Cargar stems:** sube `title` (obligatorio), `artist`, `tempo`, `cover` y los 4 stems (`voz`, `guitarra`, `bajo`, `bateria`) → `POST /songs/custom/manual`. Responde `201` con `status: ready`.

**Editar/eliminar:** solo para canciones custom (botón "Editar"/"Eliminar" en la canción activa):

- `PATCH /songs/custom/{slug}` — edita metadata, `cover`, stems individuales o sube `raw` nuevo (vuelve a separar en background; `status: processing`).
- `DELETE /songs/custom/{slug}` — borra la carpeta completa de la canción (pide confirmación).

**Pitfalls:**

- `title` define el slug (`slugify`); si ya existe, la API agrega sufijo numérico.
- Los archivos se validan por **magic bytes** (`detect_upload_type`): la extensión debe coincidir con el contenido real; subir un HTML con extensión `.mp3` da `400`.
- Límite de subida: 200 MB (`MAX_UPLOAD_BYTES`).
- Las canciones custom **no se versionan en git**; viven en `custom-songs/` (volumen Docker) y aparecen solo si la API está disponible (si no, `fetchCustomSongs` devuelve `[]` silenciosamente).
- `PATCH` con `raw` pone `status: processing` y vacía `tracks` hasta terminar.

---

## Skill 4: Checkpoints y control por Bluetooth MIDI

**Cuándo:** configurar puntos de ensayo por canción (intro, verso, coro, solo…) y saltar entre ellos con un pedal/controlador MIDI.

**Pasos:**

1. En el player, abrir **"Activar checkpoints"** → panel de checkpoints.
2. Crear un **grupo** (ej: "Setlist ensayo") y agregar checkpoints desde la posición actual del timeline ("Agregar en posición actual"). Se pueden editar nombre/tiempo inline (al hacer blur) y borrar.
3. En la sección MIDI del panel, definir **CC Next** (default 21) y **CC Prev** (default 22) y guardar. Estos quedan por canción (tabla `song_midi_controls`).
4. Presionar **"Activar MIDI"** (pide permiso Web MIDI; funciona con controladores Bluetooth).
5. Al recibir un mensaje Control Change (`0xB0`) con el CC configurado, el reproductor salta al checkpoint siguiente/anterior del grupo activo.

**Pitfalls:**

- Web MIDI requiere navegador compatible (Chrome/Edge; Safari no lo soporta). El estado del panel lo informa ("Este navegador no soporta Web MIDI").
- La persistencia es SQLite (`api-data/app.db` en local, `/data/app.db` en Docker) vía `GET /songs/{slug}/checkpoints` y `PATCH /songs/{slug}/midi-controls`; si la API no está, los checkpoints no cargan (el hook cae a defaults silenciosamente).
- El "checkpoint activo" es el último con `time <= currentTime + 0.25 s` del grupo seleccionado.
- CC se normaliza a 0–127 (`normalizeCc` / `coerce_midi_cc`).

---

## Skill 5: Editar metadata de un mp3 (tags ID3)

**Cuándo:** se quiere que `separate.sh` o el endpoint de custom lean título/artista/BPM correctos del master (fallback del pipeline).

**Pasos:**

1. La API lee con `mutagen` (easy tags): `title`, `artist`, `bpm` (o `tbpm`) — ver `extract_metadata()` en `tools/stemsplitter/app.py`.
2. Para setear tags desde terminal (requiere el venv de la API):
   ```bash
   cd tools/stemsplitter && .venv/bin/python - <<'PY'
   from mutagen.easyid3 import EasyID3
   f = EasyID3("ruta/raw.mp3")
   f["title"] = "Canción"; f["artist"] = "Banda"; f["bpm"] = "164"
   f.save()
   PY
   ```
3. Re-ejecutar el pipeline (Skill 2) o la subida custom para que tome los nuevos valores.

**Pitfalls:**

- El orden de precedencia en la API: valor del form (`title`/`artist`/`tempo` del POST) > metadata del mp3 > slug humanizado.
- El BPM se coerce con `coerce_tempo` (float > 0); valores inválidos quedan `null` y la app cae a 120 BPM por defecto (`clampBpm`).

---

## Skill 6: Build, Docker y deploy

**Cuándo:** levantar local, empaquetar, o desplegar (Railway).

**Pasos (local):**

1. `docker compose up --build` → web en `http://localhost:8080`, API en `http://localhost:4000`.
2. Volúmenes: `./api-data:/data` (SQLite `app.db`) y `./custom-songs:/data/custom-songs` — persisten entre runs.
3. La web lee la URL de la API desde `VITE_STEM_SPLITTER_URL`. En Docker se inyecta en runtime a `config.js` (`nginx/30-runtime-config.sh` escribe `window.__APP_CONFIG__`); en dev local, `inMemorySongRepository` usa `import.meta.env.VITE_STEM_SPLITTER_URL` o `http://localhost:4000`.

**Pasos (Railway):**

- La imagen web sirve en el puerto de la variable `PORT` (nginx template; default 80).
- Setear `VITE_STEM_SPLITTER_URL` como **variable de runtime** (no build-time): el entrypoint de nginx la inyecta a `/config.js` al arrancar.
- La API necesita persistencia: montar volúmenes para `/data/custom-songs` y `/data/app.db` (o un volumen Railway).

**Pitfalls:**

- `npm ci` en Docker requiere `package-lock.json` versionado.
- La imagen de la API instala `ffmpeg` (requerido por Demucs) y los requirements de `tools/stemsplitter/requirements.txt` (demucs==4.0.1, Flask==3.0.3, Flask-Cors==5.0.0, mutagen==1.47.0).
- Existen **dos** Dockerfiles de API: `api/Dockerfile` (contexto raíz, usado por compose) y `tools/stemsplitter/Dockerfile` (contexto propio, para builds independientes). No confundirlos.
- Los commits "trigger-build" del historial sugieren auto-deploy por push en Railway; verificar con el usuario antes de asumir CI.

---

## Skill 7: Debugging de sincronía y reproducción

**Cuándo:** las pistas se desfasan, el metrónomo no suena/desfasa, el BPM o pitch se comportan raro, o el loop A-B no salta.

**Puntos de control (en `src/application/useCases/useMultiTrackPlayer.js`):**

1. **Deriva entre pistas:** umbrales `SYNC_THRESHOLD_S = 0.12` (corrección suave por frame) y `HARD_RESYNC_THRESHOLD_S = 0.2` (re-sync cada 1 s). Si una pista se desfasa, se le fuerza `currentTime = master.currentTime`.
2. **Pista maestra:** `PREFERRED_MASTER = 'voz'`; si falta, primer track no sintético. El master define `currentTime`/`duration`/fin de reproducción (`ended`).
3. **Metrónomo:** si existe `metronomo.mp3` se usa como pista normal (`probeAudioTrack` con timeout 2.5 s); si no, `MetronomeEngine` (scheduler look-ahead 25 ms, acento cada 4 tiempos). El **count-in de 4 tiempos** suena siempre (ignora mute, gain independiente) y el audio arranca tras `delayMs`.
4. **BPM/pitch:** `playbackRate = (targetBpm/baseBpm) * 2^(semitones/12)`; el metrónomo sintético corre a `metronomeBpm = targetBpm * pitchRate` sobre la posición de la canción dividida por `playbackRate`. Clamps: BPM 40–220, semitonos −6..+6.
5. **Loop A-B:** `markAbLoopPoint` (dos marcas con mínimo 0.5 s), verificación en el tick: si `currentTime >= end`, salta a `start` y reinicia el metrónomo sintético en la posición equivalente.
6. **Audio no arranca en móvil:** el `AudioContext` se desbloquea en el gesto (`metronomeEngine.unlock()`, `audioGraph.context.resume()`); `audio.muted` se usa en vez de `volume=0` por confiabilidad en iOS/Android.

**Pitfalls:**

- Nunca tocar `dist/` para "probar" cambios: rebuild con `npm run build`.
- Los refs espejo (`...Ref`) son la fuente de verdad dentro de timers/animation frames; un bug típico es leer el estado React directamente dentro de `requestAnimationFrame`.
- Si una pista se queda pausada por el navegador (autoplay policy), el tick la relanza (`syncSlaveTracks`).
