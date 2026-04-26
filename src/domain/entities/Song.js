const DEFAULT_TRACKS = ['voz', 'guitarra', 'bajo', 'bateria', 'metronomo']

export function createSong(song) {
  const baseTracks = song.tracks?.length ? song.tracks : DEFAULT_TRACKS
  // Garantiza que 'metronomo' siempre esté disponible
  const tracks = baseTracks.includes('metronomo') ? baseTracks : [...baseTracks, 'metronomo']
  return {
    id: song.id,
    slug: song.slug,
    title: song.title,
    artist: song.artist,
    bpm: song.bpm,
    tracks,
  }
}
