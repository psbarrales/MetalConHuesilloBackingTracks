import { createSong } from '../../domain/entities/Song'

const songCatalog = import.meta.glob('../../../public/audio/*/song.json', {
  eager: true,
  import: 'default',
})

function extractSlug(filePath) {
  const match = filePath.match(/\/audio\/([^/]+)\/song\.json$/)
  return match?.[1] ?? null
}

function compareSongs(leftSong, rightSong) {
  return leftSong.title.localeCompare(rightSong.title, 'es', { sensitivity: 'base' })
}

const songs = Object.entries(songCatalog)
  .map(([filePath, song]) => {
    const slug = song.slug ?? extractSlug(filePath)
    if (!slug) return null

    return createSong({
      id: song.id ?? `song:${slug}`,
      slug,
      title: song.title ?? slug,
      artist: song.artist ?? '',
      bpm: song.tempo ?? song.bpm ?? 120,
      tracks: song.tracks,
    })
  })
  .filter(Boolean)
  .sort(compareSongs)

export const inMemorySongRepository = {
  listSongs() {
    return songs
  },
}
