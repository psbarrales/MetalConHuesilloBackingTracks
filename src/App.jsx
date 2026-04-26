import { useEffect, useState } from 'react'
import { useMultiTrackPlayer } from './application/useCases/useMultiTrackPlayer'
import { inMemorySongRepository } from './infrastructure/repositories/inMemorySongRepository'
import { SongSelector } from './ui/components/SongSelector'
import { TrackMixer } from './ui/components/TrackMixer'
import { TransportControls } from './ui/components/TransportControls'
import { Timeline } from './ui/components/Timeline'
import './App.css'

function App() {
  const [coverLoaded, setCoverLoaded] = useState(true)
  const [coverIndex, setCoverIndex] = useState(0)

  const {
    songs,
    currentSong,
    currentSongId,
    isPlaying,
    isPreparingPlayback,
    countIn,
    baseBpm,
    targetBpm,
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
    setVolume,
    toggleMute,
  } = useMultiTrackPlayer(inMemorySongRepository)

  const coverCandidates = currentSong
    ? [`/audio/${currentSong.slug}/portada.png`, `/${currentSong.slug}/portada.png`]
    : []
  const coverSrc = coverCandidates[coverIndex] ?? ''

  useEffect(() => {
    setCoverLoaded(true)
    setCoverIndex(0)
  }, [currentSongId])

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
          </div>
        </div>

        <div className="now-playing">
          <div className="cover-center">
            {coverSrc && coverLoaded ? (
              <img
                className="song-cover"
                src={coverSrc}
                alt={`Portada de ${currentSong?.title ?? 'cancion'}`}
                onError={() => {
                  if (coverIndex < coverCandidates.length - 1) {
                    setCoverIndex((prev) => prev + 1)
                  } else {
                    setCoverLoaded(false)
                  }
                }}
              />
            ) : (
              <div className="song-cover song-cover-fallback">SIN PORTADA</div>
            )}
          </div>

          <h2>{currentSong?.title ?? 'Sin canciones'}</h2>
          <p>{currentSong?.artist ?? 'Agrega canciones en /public/audio'}</p>
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
        <p>Coloca los archivos en <code>/public/audio/&lt;slug&gt;/voz.mp3</code>, <code>guitarra.mp3</code>, <code>bajo.mp3</code>, <code>bateria.mp3</code></p>
      </footer>
    </main>
  )
}

export default App
