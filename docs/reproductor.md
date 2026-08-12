# Motor de reproducción multi-track

Todo vive en `src/application/useCases/useMultiTrackPlayer.js` (hook React) + `src/domain/services/MetronomeEngine.js`. Esta es la pieza más delicada del proyecto.

## Modelo de audio

- Un elemento **`<audio>` por pista** por canción, creado en un efecto al cambiar `currentSong.id`. URLs: `{baseUrl}/{trackId}.mp3` (`buildTrackUrl`).
- Cada audio con `crossOrigin = 'anonymous'` se conecta a un **`AudioContext`** compartido vía `createMediaElementSource` + **`StereoPanner`** (paneo −1..1) → `destination`. Si el navegador no tiene `createStereoPanner`, el audio queda sin panner (solo mute/volumen).
- **`metronomo` es especial:** si existe `metronomo.mp3` en la carpeta de la canción (detectado con `probeAudioTrack`, timeout 2,5 s), se crea como pista normal (`useAudioMetronomeRef = true`). Si no, se usa el metrónomo sintético de `MetronomeEngine` y **no** se crea elemento de audio para él.
- El **estado por pista** (mute, pan, volumen) se propaga con efectos que iteran `audioElementsRef.current` / `audioGraphRef.current.panners`.

## Sincronía maestro/esclavo

- **Maestro:** `PREFERRED_MASTER = 'voz'`; si la canción no tiene voz, el primer track no `synthetic`. El maestro es la fuente de verdad de `currentTime`, `duration` y fin de reproducción (evento `ended` → detener todo y volver a 0).
- **Loop de tiempo:** `requestAnimationFrame` por frame (tick) que actualiza `currentTime` desde el master y corrige deriva suave; más un `setInterval` de 1 s que hace **re-sync duro**.
- **Corrección de deriva:** si `|esclavo.currentTime - master.currentTime| > SYNC_THRESHOLD_S (0.12)` se fuerza `esclavo.currentTime = master.currentTime`. El re-sync duro usa `HARD_RESYNC_THRESHOLD_S (0.2)`. Si una pista quedó pausada por el navegador (autoplay policy), se relanza con `audio.play()`.
- Al hacer **seek**, todas las pistas se posicionan juntas (`seekElementsTo`) y el metrónomo sintético se reinicia en la nueva posición.

## Tempo y transposición

```
playbackRate = (targetBpm / baseBpm) * 2^(semitones / 12)
metronomeBpm  = targetBpm * 2^(semitones / 12)
```

- `baseBpm` viene de `song.json` (`tempo`); `targetBpm` es editable en UI (clamp 40–220, default 120).
- **Pitch:** `applyTrackPitchBehavior` setea `preservesPitch` según el track: `voz`, `guitarra` y `bajo` son **tonales** (`isTonalTrack`) → no preservan pitch (transponen de verdad); batería y metrónomo **sí** lo preservan. Soporta `preservesPitch`, `webkitPreservesPitch`, `mozPreservesPitch`.
- Cambiar `playbackRate` o pitch reinicia el metrónomo sintético en la posición equivalente (`metronomePosition = mediaPosition / playbackRate`).

## Metrónomo

`MetronomeEngine` (Web Audio, sin assets):

- **Scheduler look-ahead:** un `setInterval` de 25 ms programa clicks dentro de una ventana de 0,1 s adelante → timing preciso sin drift de `setInterval` puro.
- Click sintético: buffer de ruido con decaimiento exponencial + highpass (acento a 1400 Hz / normal 1000 Hz) + gain (0.9 / 0.6). Acento cada 4 tiempos (compás 4/4).
- `setMuted()` cambia el gain del master en tiempo real; `setPan()` panea el click.
- **Count-in:** `countIn(bpm, beats=4)` genera N clicks **siempre audibles** (gain independiente del master, ignora el mute) y devuelve `{ delayMs, beatTimingsMs }` para que la UI muestre 4·3·2·1 y arranque el audio exactamente cuando termina la cuenta.
- `start(bpm, songPositionS)`: calcula el siguiente tiempo de la canción (incluyendo fracción de compás) y arranca el loop sincronizado con la posición.

## Loop A-B

- `markAbLoopPoint(time)`: primera marca = inicio; segunda = fin (mínimo 0,5 s entre marcas; se ordenan start<end). `toggleAbLoop` activa/desactiva; `clearAbLoop` borra.
- En el tick del rAF: si el loop está activo y `master.currentTime >= end`, se hace `seekElementsTo(start)` y se reinicia el metrónomo sintético en `start`. Los puntos se normalizan contra `duration` (`normalizeLoopPoint`).

## Checkpoints y MIDI

- **Persistencia:** la API guarda por canción (`song_slug`): controles MIDI (`song_midi_controls`: `next_cc`, `prev_cc`, defaults 21/22) y grupos de checkpoints (`checkpoint_groups` → `checkpoints` con `label`, `time_seconds`, `sort_order`). El hook carga todo con `GET /songs/{slug}/checkpoints` y normaliza el payload (`normalizeCheckpointPayload`).
- **Checkpoint activo:** el último con `time <= currentTime + 0.25 s` (`CHECKPOINT_EPSILON_S`) del grupo seleccionado.
- **Navegación:** `goToNextCheckpoint`/`goToPrevCheckpoint` saltan al siguiente/anterior (wrapping al extremo opuesto).
- **Web MIDI:** en `CheckpointPanel.jsx`, "Activar MIDI" pide `navigator.requestMIDIAccess()`. Cada mensaje Control Change (`statusByte & 0xF0 === 0xB0`) compara el controller con `midiControls.nextCc`/`prevCc` y dispara next/prev. Los handlers se mantienen frescos en `latestHandlersRef` (evita closures viejos). Defaults: next=CC21, prev=CC22.

## Estados de reproducción

- `isPreparingPlayback`: esperando `canplaythrough` de todas las pistas (timeout 15 s por pista).
- `countIn`: 4 → 3 → 2 → 1 durante la cuenta regresiva; presionar play otra vez **cancela** el count-in.
- Al pausar se detienen todas las pistas + metrónomo + loops de tracking; al reanudar desde una posición > 0 no hay count-in (solo desde el inicio).

## Características de compatibilidad

- `AudioContext ?? webkitAudioContext`; `createStereoPanner` opcional.
- `audio.muted` para mutear (iOS/Android).
- Al cambiar de canción se limpia todo: timers de count-in, rAF, interval de sync, metrónomo, panners/sources desconectados, y se resetea `duration/currentTime/loadedTracks/abLoop`.
- La última canción seleccionada persiste en `localStorage` (`backingtrack:last-song-id`).
