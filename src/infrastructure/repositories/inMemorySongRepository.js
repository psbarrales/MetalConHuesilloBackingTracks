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
      baseUrl: `/audio/${slug}`,
      custom: false,
    })
  })
  .filter(Boolean)
  .sort(compareSongs)

const runtimeConfig = typeof window === 'undefined' ? {} : window.__APP_CONFIG__ ?? {}
const API_BASE_URL =
  runtimeConfig.VITE_STEM_SPLITTER_URL || import.meta.env.VITE_STEM_SPLITTER_URL || 'http://localhost:4000'

async function fetchCustomSongs() {
  try {
    const response = await fetch(`${API_BASE_URL}/songs/custom`)
    if (!response.ok) {
      return []
    }

    const payload = await response.json()
    return (payload.songs ?? []).map((song) =>
      createSong({
        id: song.id,
        slug: song.slug,
        title: song.title,
        artist: song.artist ?? '',
        bpm: song.tempo ?? song.bpm ?? 120,
        tracks: song.tracks,
        baseUrl: song.baseUrl,
        custom: true,
      }),
    )
  } catch {
    return []
  }
}

export const songRepository = {
  async listSongs() {
    const customSongs = await fetchCustomSongs()
    return [...songs, ...customSongs].sort(compareSongs)
  },

  async createCustomSong({ file, title, artist, tempo }) {
    const formData = new FormData()
    formData.append('file', file)
    if (title) formData.append('title', title)
    if (artist) formData.append('artist', artist)
    if (tempo) formData.append('tempo', tempo)

    const response = await fetch(`${API_BASE_URL}/songs/custom`, {
      method: 'POST',
      body: formData,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error ?? 'No se pudo crear la canción.')
    }

    return createSong({
      ...payload.song,
      bpm: payload.song?.tempo ?? payload.song?.bpm ?? 120,
      custom: true,
    })
  },
}

export const inMemorySongRepository = {
  listSongs() {
    return songs
  },
}
