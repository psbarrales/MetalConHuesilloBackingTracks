# Arquitectura

## Vista general

```
┌────────────────────────────────────────────────────────────────┐
│  Navegador (SPA React + Vite)                                   │
│                                                                │
│  src/ui (componentes)                                          │
│     └── src/application/useCases/useMultiTrackPlayer.js        │
│           └── src/domain (entidades, constantes, servicios)    │
│           └── src/infrastructure/inMemorySongRepository.js     │
│                                                                │
│   ┌───────────────┐   ┌───────────────┐                        │
│   │ /audio/{slug} │   │ API (Flask)   │  HTTP (fetch)          │
│   │ (estáticas,   │   │ :4000         │                        │
│   │  servidas por │   └───────┬───────┘                        │
│   │  nginx/vite)  │           │                                │
│   └───────────────┘   ┌───────▼────────┐                       │
│                       │ Demucs (stems) │                       │
│                       │ SQLite (check) │                       │
│                       │ custom-songs/  │                       │
│                       └────────────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

El frontend es una **arquitectura semi-hexagonal**: las reglas puras viven en `domain`, la orquestación en `application`, la obtención de datos en `infrastructure` y la presentación en `ui`. No es una hexagonal estricta (no hay puertos formales ni DI), pero la separación de responsabilidades es consistente.

## Capas del frontend

### `src/domain` — reglas puras (sin React, sin I/O)

| Archivo | Responsabilidad |
|---|---|
| `entities/Song.js` | `createSong()` normaliza una canción: define `tracks` (garantiza que `metronomo` siempre exista), `baseUrl` (`/audio/{slug}` por defecto), flag `custom`. |
| `constants/trackTypes.js` | `TRACK_TYPES`: `voz` (única no muteada por defecto), `guitarra`, `bajo`, `bateria` (muteadas por defecto), `metronomo` (`defaultMuted: true`, `synthetic: true` → no requiere archivo, lo genera el motor). |
| `constants/trackModes.js` | **Legacy** del reproductor de "modos" (guitarra/bajo/bateria/cuerdas/acapella). Sin uso actual. |
| `services/MetronomeEngine.js` | Metrónomo sintético por Web Audio: scheduler look-ahead 25 ms, acento en tiempo 1 de 4/4, `countIn()`, `start()`, `setMuted()`, `setPan()`. Singleton `metronomeEngine`. |
| `services/TrackSelectionService.js` | **Legacy** (resolución de modo → archivo). Sin uso actual. |

### `src/application/useCases` — hooks de orquestación

| Hook | Estado |
|---|---|
| **`useMultiTrackPlayer.js`** | **Activo.** Todo el reproductor multi-track: elementos `<audio>` por pista, grafo Web Audio (panners stereo), sincronía maestro/esclavo, BPM, pitch, loop A-B, checkpoints, MIDI. ~1.080 líneas. |
| `useBackingTrackPlayer.js` | **Legacy sin uso.** Un solo `<audio>` que cambia de archivo según "modo" (`guitarra.mp3`, `bajo.mp3`…). Era el reproductor original. |

### `src/infrastructure` — acceso a datos

`inMemorySongRepository.js` exporta `songRepository` (el usado por `App.jsx`):

- **Catálogo estático:** `import.meta.glob('../../../public/audio/*/song.json', { eager: true })` — Vite embebe los manifiestos en el bundle. Cada canción se normaliza con `createSong()` y se ordena por título (collation es).
- **Catálogo custom:** `GET {API}/songs/custom`, filtra `status === 'ready'` y marca `custom: true`. Si la API no responde, devuelve `[]` (las estáticas siguen funcionando).
- **URL de la API:** `window.__APP_CONFIG__.VITE_STEM_SPLITTER_URL` (inyectado en runtime por nginx) → `import.meta.env.VITE_STEM_SPLITTER_URL` → `http://localhost:4000`.
- **Operaciones custom:** create (separar / manual), update (PATCH), delete, status polling, checkpoints y MIDI (CRUD completo sobre la API).

### `src/ui` — componentes

| Componente | Función |
|---|---|
| `SongSelector.jsx` | Listado de canciones (estáticas + custom) |
| `TrackMixer.jsx` | Mute + paneo (izquierda/stereo/derecha) por pista, estado de carga |
| `Timeline.jsx` | Seek, loop A-B (marcas, toggle, clear) y render de checkpoints sobre la línea |
| `TransportControls.jsx` | Play/pause, −10 s / +10 s, indicador de count-in |
| `CheckpointPanel.jsx` | Grupos, checkpoints, CC MIDI, activación Web MIDI |
| `LyricsPanel.jsx` | Letra actual y siguiente (desde `lyrics.srt`) |
| `ModeSelector.jsx` | **Legacy sin uso** (selector de modos del reproductor viejo) |

Formateadores: `formatters/srt.js` (parser SRT → `{start, end, text}` en segundos) y `formatters/time.js` (`mm:ss`).

## Backend — API de stems y checkpoints

`tools/stemsplitter/app.py` (Flask, ~925 líneas). Un solo servicio con dos dominios:

1. **Separación de stems:** `POST /separate` (zip descargable), `POST /metadata`, y el CRUD de canciones custom (`/songs/custom*`) que separa en background con Demucs (`htdemucs`), mapea stems (`vocals→voz`, `bass→bajo`, `drums→bateria`, `other→guitarra`) y escribe `song.json` por canción.
2. **Checkpoints y MIDI:** tablas SQLite (`song_midi_controls`, `checkpoint_groups`, `checkpoints`) con endpoints REST para leer/crear/editar/borrar.

Detalles: [api-stems.md](api-stems.md).

## Configuración y despliegue

- `index.html` carga `/config.js` (runtime) antes del bundle; `public/config.js` es el stub de dev (`window.__APP_CONFIG__ = {}`).
- Docker: `Dockerfile` multi-stage (node:20 build → nginx:1.27 con template `${PORT}` y `30-runtime-config.sh` que escribe `config.js` con `VITE_STEM_SPLITTER_URL`). La API usa `api/Dockerfile` (python:3.11-slim + ffmpeg + demucs).
- `docker-compose.yml` orquesta web (:8080) + stemsplitter (:4000) con volúmenes `./api-data:/data` y `./custom-songs:/data/custom-songs`.

Detalles: [despliegue.md](despliegue.md).

## Flujos principales

### Reproducción (resumen)

1. `App.jsx` monta `useMultiTrackPlayer(songRepository)` → `listSongs()` (estáticas + custom).
2. Al elegir canción, el hook crea un `<audio>` por track (`voz/guitarra/bajo/bateria` + `metronomo.mp3` si existe), los conecta a `AudioContext` con `StereoPanner` por pista, y aplica estado inicial (mutes, volumen, pan, `playbackRate`).
3. Play → `waitForTrackReady` en todas → si es desde el inicio, **count-in de 4 tiempos** (siempre audible) → arrancan todas las pistas → `startTimeTracking` (rAF + interval de re-sync).
4. El master (`voz`) define el tiempo; los esclavos se corrigen por deriva. El metrónomo sintético (si aplica) se sincroniza con la posición de la canción.

### Subida de canción custom

1. UI → `POST /songs/custom` (multipart `file` + metadata opcional) → `201 {status: processing}`.
2. Thread daemon corre `demucs.separate` → mapea stems → escribe `song.json` (`ready`) o `error`.
3. La UI hace polling `GET /songs/custom/{slug}/status` cada 3,5 s; al estar `ready`, recarga el catálogo y selecciona la canción.

## Decisiones de diseño relevantes

- **`audio.muted` en vez de `volume = 0`** para mutear: más confiable en iOS/Android (autoplay policy).
- **`preservesPitch` condicional:** al transponer, las pistas tonales (voz/guitarra/bajo) cambian de tono con el rate; batería y metrónomo mantienen pitch.
- **Refs espejo** (`*Ref`) para todo estado leído dentro de timers/`requestAnimationFrame`: evita closures obsoletos en el loop de sincronía.
- **Metrónomo sintético vs archivo:** si `metronomo.mp3` existe en la carpeta de la canción, se usa como pista real (mayor fidelidad); si no, `MetronomeEngine` genera clicks (cero assets).
- **Validación de uploads por magic bytes** (no solo extensión): `detect_upload_type()` compara los primeros bytes del archivo contra firmas conocidas (ID3/0xFFE0 para mp3, RIFF/WAVE, OggS, fLaC, PNG/JPEG/WEBP) y exige que coincidan con la extensión declarada.
