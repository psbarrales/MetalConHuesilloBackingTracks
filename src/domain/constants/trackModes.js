export const TRACK_MODES = [
  {
    id: 'guitarra',
    label: 'Backing Track para guitarra',
    description: 'Incluye bajo, voz y bateria.',
    fileName: 'guitarra.mp3',
  },
  {
    id: 'bajo',
    label: 'Backing Track para bajo',
    description: 'Incluye guitarra, voz y bateria.',
    fileName: 'bajo.mp3',
  },
  {
    id: 'bateria',
    label: 'Backing Track para bateria',
    description: 'Incluye guitarra, bajo y voz.',
    fileName: 'bateria.mp3',
  },
  {
    id: 'cuerdas',
    label: 'Backing Track para cuerdas',
    description: 'Incluye voz y bateria.',
    fileName: 'cuerdas.mp3',
  },
  {
    id: 'acapella',
    label: 'Backing Track acapella',
    description: 'Solo voz.',
    fileName: 'acapella.mp3',
  },
]

export const TRACK_MODE_BY_ID = TRACK_MODES.reduce((acc, mode) => {
  acc[mode.id] = mode
  return acc
}, {})
