import { TRACK_MODE_BY_ID } from '../constants/trackModes'

function resolveMode(song, preferredModeId) {
  if (!song) {
    return null
  }

  if (song.modesAvailable.includes(preferredModeId)) {
    return preferredModeId
  }

  return song.modesAvailable[0] ?? null
}

function getModeAudioPath(song, modeId) {
  const resolvedMode = resolveMode(song, modeId)

  if (!song || !resolvedMode) {
    return ''
  }

  const modeConfig = TRACK_MODE_BY_ID[resolvedMode]

  if (!modeConfig) {
    return ''
  }

  return `/audio/${song.slug}/${modeConfig.fileName}`
}

export const TrackSelectionService = {
  resolveMode,
  getModeAudioPath,
}
