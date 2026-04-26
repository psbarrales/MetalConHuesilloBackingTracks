/**
 * Tipos de pista disponibles en el reproductor multi-track.
 * defaultMuted: true  → la pista arranca silenciada
 * defaultMuted: false → la pista arranca activa
 */
/**
 * synthetic: true → no corresponde a un archivo .mp3; lo genera el motor de audio.
 */
export const TRACK_TYPES = [
  { id: 'voz', label: 'Voz', defaultMuted: false },
  { id: 'guitarra', label: 'Guitarra', defaultMuted: true },
  { id: 'bajo', label: 'Bajo', defaultMuted: true },
  { id: 'bateria', label: 'Batería', defaultMuted: true },
  { id: 'metronomo', label: 'Metrónomo', defaultMuted: true, synthetic: true },
]

export const TRACK_TYPE_BY_ID = TRACK_TYPES.reduce((acc, t) => {
  acc[t.id] = t
  return acc
}, {})
