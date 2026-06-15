import { useEffect, useState } from 'react'
import { useMultiTrackPlayer } from './application/useCases/useMultiTrackPlayer'
import { songRepository } from './infrastructure/repositories/inMemorySongRepository'
import { LyricsPanel } from './ui/components/LyricsPanel'
import { SongSelector } from './ui/components/SongSelector'
import { TrackMixer } from './ui/components/TrackMixer'
import { parseSrt } from './ui/formatters/srt'
import { TransportControls } from './ui/components/TransportControls'
import { Timeline } from './ui/components/Timeline'
import './App.css'

function App() {
  const [coverState, setCoverState] = useState({ songId: null, index: 0, loaded: true })
  const [lyrics, setLyrics] = useState([])
  const [customSongForm, setCustomSongForm] = useState({
    file: null,
    title: '',
    artist: '',
    tempo: '',
  })
  const [customSongStatus, setCustomSongStatus] = useState({ type: 'idle', message: '' })

  const {
    songs,
    currentSong,
    currentSongId,
    isPlaying,
    isPreparingPlayback,
    countIn,
    baseBpm,
    targetBpm,
    pitchSemitones,
    currentTime,
    duration,
    volume,
    muteState,
    loadedTracks,
    selectSong,
    togglePlayback,
    seekTo,
    seekBy,
    setTargetBpm,
    setPitchSemitones,
    setVolume,
    toggleMute,
    reloadSongs,
  } = useMultiTrackPlayer(songRepository)

  const coverCandidates = currentSong
    ? [`${currentSong.baseUrl}/portada.png`, `/${currentSong.slug}/portada.png`]
    : []
  const coverStateMatchesSong = coverState.songId === currentSongId
  const coverIndex = coverStateMatchesSong ? coverState.index : 0
  const coverLoaded = coverStateMatchesSong ? coverState.loaded : true
  const coverSrc = coverCandidates[coverIndex] ?? ''

  useEffect(() => {
    let cancelled = false

    async function loadLyrics() {
      if (!currentSong?.slug) {
        setLyrics([])
        return
      }

      try {
        const response = await fetch(`${currentSong.baseUrl}/lyrics.srt`)
        if (!response.ok) {
          setLyrics([])
          return
        }

        const rawSrt = await response.text()
        if (!cancelled) {
          setLyrics(parseSrt(rawSrt))
        }
      } catch {
        if (!cancelled) {
          setLyrics([])
        }
      }
    }

    loadLyrics()

    return () => {
      cancelled = true
    }
  }, [currentSong?.baseUrl, currentSong?.slug])

  async function handleCreateCustomSong(event) {
    event.preventDefault()

    if (!customSongForm.file) {
      setCustomSongStatus({ type: 'error', message: 'Selecciona un archivo de audio.' })
      return
    }

    setCustomSongStatus({
      type: 'loading',
      message: 'Separando y guardando canción. Esto puede tardar varios minutos.',
    })

    try {
      const song = await songRepository.createCustomSong(customSongForm)
      await reloadSongs()
      selectSong(song.id)
      setCustomSongForm({ file: null, title: '', artist: '', tempo: '' })
      event.currentTarget.reset()
      setCustomSongStatus({ type: 'success', message: `Canción guardada: ${song.title}` })
    } catch (error) {
      setCustomSongStatus({
        type: 'error',
        message: error.message ?? 'No se pudo crear la canción.',
      })
    }
  }

  const activeLyricIndex = lyrics.findIndex(
    (line) => currentTime >= line.start && currentTime < line.end,
  )
  const currentLyric = activeLyricIndex >= 0 ? lyrics[activeLyricIndex] : null
  const nextLyric = activeLyricIndex >= 0 ? lyrics[activeLyricIndex + 1] : lyrics[0]

  return (
    <main className="app-shell">
      <header className="hero-header">
        <img
          className="band-logo"
          src="/logo.png"
          alt="Metal con Huesillo"
          loading="eager"
          decoding="async"
        />
        <h1>Backing Tracks de Ensayo</h1>
        <p>Mezcla stems en vivo, cuenta inicial y tempo variable para tocar bien ajustado.</p>
      </header>

      <section className={`player-card ${isPlaying ? 'is-playing' : ''}`}>
        <div className="meta-row">
          <SongSelector songs={songs} currentSongId={currentSongId} onSelect={selectSong} />
          <div className="control-stack">
            <label className="volume-selector">
              Volumen
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>

            <label className="tempo-selector">
              Tempo Objetivo (BPM)
              <input
                type="number"
                min="40"
                max="220"
                step="1"
                value={targetBpm}
                onChange={(event) => setTargetBpm(Number(event.target.value))}
              />
            </label>

            <label className="tempo-selector">
              Transposición (semitonos)
              <input
                type="number"
                min="-6"
                max="6"
                step="1"
                value={pitchSemitones}
                onChange={(event) => setPitchSemitones(Number(event.target.value))}
              />
              <small className="transpose-hint">
                Afecta voz, guitarra y bajo. Batería mantiene su pitch.
              </small>
            </label>
          </div>
        </div>

        <form className="custom-song-form" onSubmit={handleCreateCustomSong}>
          <div>
            <p className="custom-song-title">Agregar canción custom</p>
            <p className="custom-song-copy">Sube un master; la API separa, guarda y expone los stems.</p>
          </div>
          <label>
            Audio
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,.mp3,.wav,.ogg,.flac"
              onChange={(event) =>
                setCustomSongForm((prev) => ({ ...prev, file: event.target.files?.[0] ?? null }))
              }
            />
          </label>
          <label>
            Título
            <input
              type="text"
              value={customSongForm.title}
              placeholder="Opcional"
              onChange={(event) =>
                setCustomSongForm((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </label>
          <label>
            Artista
            <input
              type="text"
              value={customSongForm.artist}
              placeholder="Opcional"
              onChange={(event) =>
                setCustomSongForm((prev) => ({ ...prev, artist: event.target.value }))
              }
            />
          </label>
          <label>
            BPM
            <input
              type="number"
              min="40"
              max="220"
              step="1"
              value={customSongForm.tempo}
              placeholder="Opcional"
              onChange={(event) =>
                setCustomSongForm((prev) => ({ ...prev, tempo: event.target.value }))
              }
            />
          </label>
          <button type="submit" disabled={customSongStatus.type === 'loading'}>
            {customSongStatus.type === 'loading' ? 'Procesando...' : 'Crear'}
          </button>
          {customSongStatus.message && (
            <p className={`custom-song-status is-${customSongStatus.type}`}>
              {customSongStatus.message}
            </p>
          )}
        </form>

        <div className="now-playing">
          <div className="cover-center">
            {coverSrc && coverLoaded ? (
              <img
                className="song-cover"
                src={coverSrc}
                alt={`Portada de ${currentSong?.title ?? 'cancion'}`}
                onError={() => {
                  if (coverIndex < coverCandidates.length - 1) {
                    setCoverState({ songId: currentSongId, index: coverIndex + 1, loaded: true })
                  } else {
                    setCoverState({ songId: currentSongId, index: coverIndex, loaded: false })
                  }
                }}
              />
            ) : (
              <div className="song-cover song-cover-fallback">SIN PORTADA</div>
            )}
          </div>

          <h2>{currentSong?.title ?? 'Sin canciones'}</h2>
          <p>{currentSong?.artist ?? 'Agrega canciones desde la interfaz o en /public/audio'}</p>
          {currentSong?.bpm && (
            <p className="bpm-label">
              Tempo base: {baseBpm} BPM · Tempo actual: {targetBpm} BPM
            </p>
          )}
        </div>

        <TrackMixer
          muteState={muteState}
          loadedTracks={loadedTracks}
          availableTracks={currentSong?.tracks ?? []}
          onToggleMute={toggleMute}
        />

        <Timeline currentTime={currentTime} duration={duration} onSeek={seekTo} />

        <LyricsPanel
          hasLyrics={lyrics.length > 0}
          currentLine={currentLyric?.text ?? ''}
          nextLine={nextLyric?.text ?? ''}
        />

        <TransportControls
          isPlaying={isPlaying}
          isPreparing={isPreparingPlayback}
          countIn={countIn}
          onToggle={togglePlayback}
          onBackward={() => seekBy(-10)}
          onForward={() => seekBy(10)}
        />
      </section>

      <footer>
        <p>Usa el formulario para canciones custom o coloca archivos en <code>/public/audio/&lt;slug&gt;/voz.mp3</code>, <code>guitarra.mp3</code>, <code>bajo.mp3</code>, <code>bateria.mp3</code> y opcionalmente <code>lyrics.srt</code></p>
      </footer>
    </main>
  )
}

export default App
