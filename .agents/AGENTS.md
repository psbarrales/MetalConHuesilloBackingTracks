# AGENTS.md — Metal Con Huesillo Backing Tracks

Guía para agentes de IA (y humanos) que trabajan en este repositorio.
Lee esto antes de tocar cualquier archivo. La documentación extendida vive en [`docs/`](../docs/README.md).

## Proyecto

Web app (SPA) en **React 19 + Vite 5** para reproducir **backing tracks por stems** en ensayos de la banda *Metal Con Huesillo*. Permite mezclar en vivo voz/guitarra/bajo/batería/metrónomo, cambiar BPM, transponer, loop A-B, letras sincronizadas y control por checkpoints vía **Bluetooth MIDI**.

Incluye una **API Python (Flask) de separación de stems con Demucs** para subir un master y obtener las pistas separadas, más persistencia en SQLite de checkpoints y controles MIDI.

Paquete npm: `backing-tracking` · Título de la app: "Backing Track Metal 🤘 — Setlist con huesillo".

## Comandos

| Comando | Uso |
|---|---|
| `npm install` | Instalar dependencias (hay `package-lock.json`, usa `npm ci` en CI/Docker) |
| `npm run dev` | Dev server Vite |
| `npm run lint` | ESLint (config flat `eslint.config.js`) |
| `npm run build` | Build a `dist/` |
| `npm run preview` | Previsualizar el build |
| `docker compose up --build` | Web en `:8080` + API de stems en `:4000` |
| `./separate.sh <slug>` | Pipeline de separación de stems para una canción estática (ver SKILLS.md) |

**Verificación obligatoria antes de terminar cualquier cambio:** `npm run lint` y `npm run build` deben pasar.

## Arquitectura (resumen)

Frontend **semi-hexagonal**:

- `src/domain` — entidades y reglas puras: `entities/Song.js`, `constants/trackTypes.js`, `services/MetronomeEngine.js`.
- `src/application/useCases` — hooks que orquestan el reproductor:
  - **`useMultiTrackPlayer.js`** ← el hook **activo** (multi-pista, sincronía, metrónomo, checkpoints).
  - `useBackingTrackPlayer.js` ← **legacy sin uso** (reproductor de un solo audio por "modos").
- `src/infrastructure/repositories/inMemorySongRepository.js` — catálogo estático vía `import.meta.glob` de `public/audio/*/song.json` + catálogo custom desde la API.
- `src/ui` — componentes (`SongSelector`, `TrackMixer`, `Timeline`, `TransportControls`, `CheckpointPanel`, `LyricsPanel`) y formateadores (`srt.js`, `time.js`).

Backend (API de stems + checkpoints):

- `tools/stemsplitter/app.py` — Flask, separación Demucs, CRUD de canciones custom, checkpoints/MIDI en SQLite.
- `api/Dockerfile` — imagen de la API (contexto raíz). Ojo: hay un segundo `tools/stemsplitter/Dockerfile` (contexto del subdirectorio) que **no** usa docker-compose.

Despliegue: `Dockerfile` multi-stage (node build → nginx con template `${PORT}` y `config.js` runtime), `nginx/`, `docker-compose.yml`, deploy en Railway (variable `VITE_STEM_SPLITTER_URL`).

Detalle completo: [`docs/arquitectura.md`](../docs/arquitectura.md) · [`docs/reproductor.md`](../docs/reproductor.md) · [`docs/api-stems.md`](../docs/api-stems.md).

## Reglas de oro

1. **Idioma:** el código, comentarios, UI y esta documentación están en **español** (variables, funciones, textos). Los **mensajes de commit van en inglés** con Conventional Commits (`feat(scope):`, `fix(scope):`).
2. **No tocar datos:** `api-data/` (SQLite), `custom-songs/` (canciones custom) y `.venv/` están gitignoreados — son runtime local. No los edites ni los versiones.
3. **`dist/` es build artifact** (gitignoreado) y puede estar desactualizado (ej: contiene `barracuda` que ya no existe en `public/audio/`). **Nunca** confíes en `dist/` como fuente de verdad ni lo edites a mano.
4. **No uses el reproductor legacy:** `useBackingTrackPlayer.js`, `domain/constants/trackModes.js`, `domain/services/TrackSelectionService.js` y `ui/components/ModeSelector.jsx` son código muerto que `App.jsx` no importa. No los extiendas; si tocas el reproductor, trabaja sobre `useMultiTrackPlayer`.
5. **Convención de stems:** cada canción vive en `public/audio/{slug}/` con `voz.mp3`, `guitarra.mp3`, `bajo.mp3`, `bateria.mp3`, opcionalmente `metronomo.mp3`, `lyrics.srt`, `portada.png` y siempre `song.json`. El `metronomo` se marca `synthetic: true` en `trackTypes.js`: si no existe `metronomo.mp3`, el motor genera el click por Web Audio.
6. **Sincronía del player:** la pista **maestra es `voz`** (`PREFERRED_MASTER` en `useMultiTrackPlayer.js`); las demás son esclavas y se corrigen por deriva (umbral suave 0.12 s, re-sync duro 0.2 s cada 1 s). Al modificar el hook, respeta el patrón de **refs espejo** (`muteStateRef`, `currentTimeRef`, …) y la limpieza de efectos (timers, `requestAnimationFrame`, `metronomeEngine.stop()`).
7. **Pitch vs BPM:** transponer semitonos multiplica el `playbackRate` (voz/guitarra/bajo cambian pitch; batería y metrónomo mantienen pitch vía `preservesPitch`) y **también** altera el BPM efectivo del metrónomo (`metronomeBpm = targetBpm * pitchRate`). No "corrijas" esto sin entenderlo.
8. **Seguridad de uploads:** la API valida el **contenido real por magic bytes** (`detect_upload_type` en `app.py`), no solo la extensión; la extensión debe coincidir con el tipo detectado. Mantén esta validación en cualquier endpoint de subida nuevo.
9. **README.md es la fuente de verdad operativa** de endpoints y flujos; si cambias la API, actualízalo (y este AGENTS.md si cambia la arquitectura).
10. **Cambios en la API** (Python) requieren rebuild del contenedor (`docker compose up -d --build backing-tracking-stemsplitter`); el frontend usa `VITE_STEM_SPLITTER_URL` (o `window.__APP_CONFIG__` inyectado en `config.js` en Docker).

## Estructura de directorios

```
├── src/
│   ├── domain/               # Entidades, constantes, servicios de dominio
│   ├── application/useCases/ # useMultiTrackPlayer (activo), useBackingTrackPlayer (legacy)
│   ├── infrastructure/       # inMemorySongRepository (estáticas + custom vía API)
│   └── ui/                   # Componentes React + formatters (srt, time)
├── public/
│   ├── audio/{slug}/         # Canción estática: stems + song.json (+ metronomo/lyrics/portada)
│   └── config.js             # Runtime config (window.__APP_CONFIG__)
├── tools/stemsplitter/       # API Flask: Demucs, canciones custom, checkpoints/MIDI
├── nginx/                    # default.conf (template) + 30-runtime-config.sh (config.js)
├── api/Dockerfile            # Imagen de la API (usada por compose)
├── Dockerfile                # Web multi-stage: node build → nginx
├── docker-compose.yml        # web :8080 + stemsplitter :4000
├── separate.sh               # Pipeline stems local (sube raw a la API, mapea stems)
└── docs/                     # Esta documentación
```

## Skills del repositorio

Procedimientos operativos (agregar canciones, separar stems, checkpoints MIDI, build/deploy, debugging de sincronía): ver [`.agents/SKILLS.md`](SKILLS.md).
