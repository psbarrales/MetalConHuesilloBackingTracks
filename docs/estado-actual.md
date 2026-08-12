# Estado actual del proyecto — cómo está construido hasta ahora

Fecha de referencia: julio 2026 (último commit: `d2b8bc3`, 2026-07-12). 27 commits en `main`, rama única, sin PRs.

## Historia de construcción (fases, desde el `git log`)

| Fecha | Commits | Qué se construyó |
|---|---|---|
| 2026-04-25 | `initial commit`, `audios`, `shares` | Arranque: SPA React + Vite con el **reproductor por modos** (`useBackingTrackPlayer` + `TrackSelectionService` + `trackModes`): un solo audio que cambia de archivo según el modo (guitarra/bajo/batería/cuerdas/acapella). Primeros audios. |
| 2026-04-25 | `feat(useMultiTrackPlayer): improve track synchronization`, `feat(audio): add pitch control in semitones` | **Nace el reproductor multi-track** (`useMultiTrackPlayer`): un `<audio>` por stem con sincronía maestro/esclavo y control de transposición en semitonos para pistas tonales. |
| 2026-04-25/27 | `song(sync): crazy train`, `add custom metronomo`, `breaking the law`, `were gonna take it` | Canciones sincronizadas; aparece el **metrónomo por canción** (`metronomo.mp3`) como alternativa al sintético. |
| 2026-04-29 | `feat(songs): add steam separator`, `delete raw` | **Separador de stems**: API Flask con Demucs + script local. |
| 2026-05-31 | `feat(song): add metronome and update steam` (×2, Crazy Train) | Metrónomo y stems actualizados para más canciones. |
| 2026-06-15 | `feat(api): add api to split steam` (×3), `trigger-build` (×3) | **Pipeline completo de la API** (separación, canciones custom, metadata, zip) + commits de trigger de build (deploy automático, probablemente Railway). |
| 2026-06-25 | `add loop` | **Loop A-B** en el timeline. |
| 2026-07-06 | `feat(looping): add monitor r/l stereo modes` (×2) | **Paneo por pista** (izquierda/stereo/derecha) — "modos de monitoreo". |
| 2026-07-07 | `feat(checkpoint): control song by bluetooth midi` | **Checkpoints por canción + control Bluetooth MIDI**: grupos de checkpoints, CC configurable, Web MIDI, persistencia SQLite. |
| 2026-07-12 | `feat(security): add secutory on upload, update metronome` (×2) | **Seguridad de uploads** (validación por magic bytes en la API) + mejoras al metrónomo (count-in, sincronización con posición). |

Patrón de trabajo visible: iteraciones cortas de una feature por vez, commits en inglés (Conventional Commits, a veces duplicados o con typos: `secutory`, `steam`, `sterio`), sin ramas ni CI visible en el repo (los `trigger-build` sugieren auto-deploy por push).

## Estado por componente

### Frontend (React 19 + Vite 5) — funcional
- Reproductor multi-track con **sincronía auto-corregida** (maestro `voz`, esclavos, re-sync cada 1 s).
- BPM objetivo (40–220) y transposición (−6..+6) en vivo; metrónomo sintético o por archivo.
- Loop A-B, letras SRT, portadas, volúmen/mute/paneo por pista.
- Checkpoints por grupos + navegación con Bluetooth MIDI (Web MIDI, CC Next/Prev por canción).
- Catálogo estático (glob de `song.json`) + catálogo custom desde la API, con polling de estado de separación.
- 6 canciones estáticas; CRUD completo de canciones custom en la UI (separar master / cargar stems / editar / eliminar).

### API (Flask + Demucs) — funcional
- Separación de stems `htdemucs` a 320 kbps, en background para canciones custom, síncrona (zip) para `POST /separate`.
- Validación de uploads por magic bytes (mp3/wav/ogg/flac/imágenes), límite 200 MB, CORS abierto, `nosniff`.
- Persistencia SQLite de checkpoints/MIDI con FK y cascada; CRUD completo.

### Despliegue — funcional
- Docker multi-stage (web nginx + api), compose con volúmenes persistentes, config de API en runtime vía `config.js`.
- Deploy en Railway con `VITE_STEM_SPLITTER_URL` runtime (evidencia indirecta: commits `trigger-build`; README lo documenta).

## Lo que ya no se usa (legacy)

| Archivo | Por qué quedó |
|---|---|
| `src/application/useCases/useBackingTrackPlayer.js` | Primer reproductor (un audio por "modos"); reemplazado por `useMultiTrackPlayer`. `App.jsx` no lo importa. |
| `src/domain/constants/trackModes.js` + `src/domain/services/TrackSelectionService.js` | Reglas de los modos del reproductor viejo. Sin uso. |
| `src/ui/components/ModeSelector.jsx` | Selector de modos del reproductor viejo. Sin uso. |
| `tools/stemsplitter/Dockerfile` | Dockerfile alternativo de la API (contexto propio); compose usa `api/Dockerfile`. No hace daño pero puede confundir. |

> Candidatos de limpieza: eliminar el reproductor legacy (y su documentación en el README sobre "modos"/`cuerdas.mp3`/`acapella.mp3`), decidir si `ModeSelector`/`trackModes` se eliminan o se reactivan.

## Deuda técnica y observaciones

1. **Código muerto:** 4 archivos legacy (ver tabla) + referencias a "modos" en `README.md` (convención de audios desactualizada: menciona `cuerdas.mp3`/`acapella.mp3` y slugs `ruta-66`/`noche-urbana` inexistentes).
2. **`dist/` stale:** contiene `barracuda`, canción que ya no está en `public/audio/`. Es build artifact gitignoreado; no es fuente de verdad.
3. **`useMultiTrackPlayer.js` es grande** (~1.080 líneas) y mezcla orquestación con detalles de audio; candidato a refactor en servicios (p. ej. un `MultiTrackAudioEngine`), con cuidado de no romper la sincronía.
4. **API y web acopladas por contrato implícito:** la URL de la API se resuelve con 3 niveles de fallback; si se mueve la API, las custom songs y checkpoints desaparecen silenciosamente del catálogo.
5. **Duplicación de commits/mensajes** con typos en el historial (cosmético).
6. **Sin tests automatizados** (ni unit ni e2e). El reproductor depende mucho del comportamiento del navegador (Web Audio, autoplay policy, Web MIDI).
7. **Seguridad pendiente de revisar:** CORS abierto en la API (aceptable para uso personal), auth inexistente (cualquiera que alcance la API puede subir/borrar canciones), el slug de `GET /songs/custom/{slug}/{path}` confía en `send_from_directory` + `get_custom_song_dir` (protege contra path traversal por resolución de `resolve()`, pero conviene testear).
8. **Metadatos de las canciones:** varios `song.json` no declaran `tempo` (quedan en 120 BPM por defecto); si la banda ensaya con tempo real, conviene completarlos.

## Próximos pasos sugeridos

- **Pulir para ensayo:** completar `tempo` en todos los `song.json`; agregar `lyrics.srt` a las canciones que faltan.
- **Limpieza:** eliminar el legacy (reproductor de modos, `trackModes`, `ModeSelector`), actualizar `README.md`, decidir qué hacer con `tools/stemsplitter/Dockerfile`.
- **Robustez:** tests del parser SRT, del normalizador de checkpoints y del cálculo de rates (BPM×pitch) — son funciones puras fáciles de testear; e2e básico del reproductor con Playwright.
- **Seguridad si se expone:** auth básica o token en la API (hoy cualquiera con acceso a la URL puede crear/borrar canciones), rate limiting en uploads.
- **Operación:** definir el setup de Railway (volumen para `/data`), CI con lint+build en push.

## Cómo se ve el mapa del repo hoy

```
📁 raíz
├── src/                 # Frontend React (domain / application / infrastructure / ui)
├── public/audio/{6}     # Canciones estáticas (stems + song.json)
├── tools/stemsplitter/  # API Flask + Demucs + SQLite
├── nginx/ · Dockerfile · api/Dockerfile · docker-compose.yml   # Despliegue
├── separate.sh          # Pipeline de stems para canciones estáticas
├── .agents/             # AGENTS.md + SKILLS.md (para agentes de IA)
└── docs/                # Esta documentación
```
