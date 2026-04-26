import { createSong } from '../../domain/entities/Song'

const songs = [
  createSong({
    id: 'song-01',
    slug: 'holy_diver',
    title: 'Holy Diver',
    artist: 'Dio',
    bpm: 92,
    tracks: ['voz', 'guitarra', 'bajo', 'bateria'],
  }),
  createSong({
    id: 'song-04',
    slug: 'crazy_train',
    title: 'Crazy Train',
    artist: 'Ozzy Osbourne',
    bpm: 138,
    tracks: ['voz', 'guitarra', 'bajo', 'bateria'],
  }),
  createSong({
    id: 'song-05',
    slug: 'breaking_the_law',
    title: 'Breaking the Law',
    artist: 'Judas Priest',
    bpm: 165,
    tracks: ['voz', 'guitarra', 'bajo', 'bateria'],
  }),
  createSong({
    id: 'song-06',
    slug: 'aces_spades',
    title: 'Ace of Spades',
    artist: 'Motorhead',
    bpm: 144,
    tracks: ['voz', 'guitarra', 'bajo', 'bateria'],
  }),
  createSong({
    id: 'song-07',
    slug: 'we_arent_gonna_take_it',
    title: "We Aren't Gonna Take It",
    artist: 'Twisted Sister',
    bpm: 148,
    tracks: ['voz', 'guitarra', 'bajo', 'bateria'],
  }),
]

export const inMemorySongRepository = {
  listSongs() {
    return songs
  },
}
