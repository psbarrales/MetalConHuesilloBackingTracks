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
  const [customSongMode, setCustomSongMode] = useState('separate')
  const [manualSongForm, setManualSongForm] = useState({
    title: '',
    artist: '',
    tempo: '',
    cover: null,
    voz: null,
    guitarra: null,
    bajo: null,
    bateria: null,
  })
  const [isCustomSongModalOpen, setIsCustomSongModalOpen] = useState(false)
  const [isEditSongModalOpen, setIsEditSongModalOpen] = useState(false)
  const [editSongForm, setEditSongForm] = useState({
    title: '',
    artist: '',
    tempo: '',
    cover: null,
    raw: null,
    voz: null,
    guitarra: null,
    bajo: null,
    bateria: null,
  })
  const [customSongJob, setCustomSongJob] = useState(null)
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
    panState,
    loadedTracks,
    abLoopEnabled,
    abLoopStart,
    abLoopEnd,
    selectSong,
    togglePlayback,
    seekTo,
    seekBy,
    setTargetBpm,
    setPitchSemitones,
    setVolume,
    toggleMute,
    setTrackPan,
    toggleAbLoop,
    clearAbLoop,
    markAbLoopPoint,
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

  useEffect(() => {
    if (!customSongJob?.slug || customSongStatus.type !== 'processing') {
      return undefined
    }

    let cancelled = false
    const pollStatus = async () => {
      try {
        const song = await songRepository.getCustomSongStatus(customSongJob.slug)
        if (cancelled) return

        if (song.status === 'ready') {
          const nextSongs = await reloadSongs()
          const readySong = nextSongs.find((item) => item.id === song.id)
          if (readySong) {
            selectSong(readySong.id)
          }
          setCustomSongJob(song)
          setCustomSongStatus({ type: 'success', message: `Canción lista: ${song.title}` })
          return
        }

        if (song.status === 'error') {
          setCustomSongJob(song)
          setCustomSongStatus({
            type: 'error',
            message: song.error ?? 'No se pudo separar la canción.',
          })
        }
      } catch (error) {
        if (!cancelled) {
          setCustomSongStatus({
            type: 'error',
            message: error.message ?? 'No se pudo consultar el proceso.',
          })
        }
      }
    }

    pollStatus()
    const intervalId = window.setInterval(pollStatus, 3500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [customSongJob?.slug, customSongStatus.type, reloadSongs, selectSong])

  async function handleCreateCustomSong(event) {
    event.preventDefault()
    const form = event.currentTarget

    if (!customSongForm.file) {
      setCustomSongStatus({ type: 'error', message: 'Selecciona un archivo de audio.' })
      return
    }

    setCustomSongStatus({
      type: 'uploading',
      message: 'Subiendo archivo y creando entrada.',
    })

    try {
      const song = await songRepository.createCustomSong(customSongForm)
      setCustomSongForm({ file: null, title: '', artist: '', tempo: '' })
      form.reset()
      setCustomSongJob(song)
      setCustomSongStatus({
        type: 'processing',
        message: `Entrada creada (${song.id}). Separando stems en background.`,
      })
    } catch (error) {
      setCustomSongStatus({
        type: 'error',
        message: error.message ?? 'No se pudo crear la canción.',
      })
    }
  }

  async function handleCreateManualSong(event) {
    event.preventDefault()
    const form = event.currentTarget

    if (!manualSongForm.title.trim()) {
      setCustomSongStatus({ type: 'error', message: 'Ingresa el nombre de la canción.' })
      return
    }

    const missingTracks = ['voz', 'guitarra', 'bajo', 'bateria'].filter((trackId) => !manualSongForm[trackId])
    if (missingTracks.length) {
      setCustomSongStatus({
        type: 'error',
        message: `Faltan mp3: ${missingTracks.join(', ')}.`,
      })
      return
    }

    setCustomSongStatus({ type: 'uploading', message: 'Subiendo stems y guardando canción.' })

    try {
      const song = await songRepository.createManualCustomSong(manualSongForm)
      const nextSongs = await reloadSongs()
      const readySong = nextSongs.find((item) => item.id === song.id)
      if (readySong) {
        selectSong(readySong.id)
      }
      setManualSongForm({
        title: '',
        artist: '',
        tempo: '',
        cover: null,
        voz: null,
        guitarra: null,
        bajo: null,
        bateria: null,
      })
      form.reset()
      setCustomSongJob(song)
      setCustomSongStatus({ type: 'success', message: `Canción guardada: ${song.title}` })
    } catch (error) {
      setCustomSongStatus({
        type: 'error',
        message: error.message ?? 'No se pudo guardar la canción manual.',
      })
    }
  }

  function openCustomSongModal() {
    setIsCustomSongModalOpen(true)
    if (customSongStatus.type === 'idle') {
      setCustomSongStatus({ type: 'idle', message: '' })
    }
  }

  function closeCustomSongModal() {
    setIsCustomSongModalOpen(false)
  }

  function openEditSongModal() {
    if (!currentSong?.custom) return

    setEditSongForm({
      title: currentSong.title ?? '',
      artist: currentSong.artist ?? '',
      tempo: currentSong.bpm ?? '',
      cover: null,
      raw: null,
      voz: null,
      guitarra: null,
      bajo: null,
      bateria: null,
    })
    setIsEditSongModalOpen(true)
  }

  function closeEditSongModal() {
    setIsEditSongModalOpen(false)
  }

  function setManualFile(field, file) {
    setManualSongForm((prev) => ({ ...prev, [field]: file }))
  }

  function setEditFile(field, file) {
    setEditSongForm((prev) => ({ ...prev, [field]: file }))
  }

  async function handleEditCustomSong(event) {
    event.preventDefault()
    const form = event.currentTarget

    if (!currentSong?.custom) {
      setCustomSongStatus({ type: 'error', message: 'Solo se pueden editar canciones custom.' })
      return
    }

    if (!editSongForm.title.trim()) {
      setCustomSongStatus({ type: 'error', message: 'Ingresa el nombre de la canción.' })
      return
    }

    setCustomSongStatus({ type: 'uploading', message: 'Guardando cambios de la canción.' })

    try {
      const song = await songRepository.updateCustomSong(currentSong.slug, editSongForm)
      form.reset()
      setEditSongForm({
        title: '',
        artist: '',
        tempo: '',
        cover: null,
        raw: null,
        voz: null,
        guitarra: null,
        bajo: null,
        bateria: null,
      })
      setCustomSongJob(song)

      if (song.status === 'processing') {
        setCustomSongStatus({
          type: 'processing',
          message: `Cambios guardados (${song.id}). Separando nuevo raw en background.`,
        })
      } else {
        const nextSongs = await reloadSongs()
        const updatedSong = nextSongs.find((item) => item.id === song.id)
        if (updatedSong) {
          selectSong(updatedSong.id)
        }
        setCoverState({ songId: null, index: 0, loaded: true })
        setCustomSongStatus({ type: 'success', message: `Canción actualizada: ${song.title}` })
      }
    } catch (error) {
      setCustomSongStatus({
        type: 'error',
        message: error.message ?? 'No se pudo editar la canción.',
      })
    }
  }

  async function handleDeleteCustomSong() {
    if (!currentSong?.custom) {
      setCustomSongStatus({ type: 'error', message: 'Solo se pueden eliminar canciones custom.' })
      return
    }

    const shouldDelete = window.confirm(`Eliminar "${currentSong.title}" y todos sus archivos custom?`)
    if (!shouldDelete) return

    try {
      await songRepository.deleteCustomSong(currentSong.slug)
      const nextSongs = await reloadSongs()
      selectSong(nextSongs[0]?.id ?? null)
      setCustomSongStatus({ type: 'success', message: `Canción eliminada: ${currentSong.title}` })
      setIsEditSongModalOpen(false)
    } catch (error) {
      setCustomSongStatus({
        type: 'error',
        message: error.message ?? 'No se pudo eliminar la canción.',
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
          <div className="song-actions">
            <SongSelector songs={songs} currentSongId={currentSongId} onSelect={selectSong} />
            <div className="song-action-buttons">
              <button type="button" className="add-song-button" onClick={openCustomSongModal}>
                Agregar canción
              </button>
              {currentSong?.custom && (
                <>
                  <button type="button" className="add-song-button secondary-action" onClick={openEditSongModal}>
                    Editar
                  </button>
                  <button type="button" className="add-song-button danger-action" onClick={handleDeleteCustomSong}>
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </div>
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

        {customSongStatus.message && !isCustomSongModalOpen && (
          <div className={`custom-song-process is-${customSongStatus.type}`}>
            <span>{customSongStatus.message}</span>
            {customSongJob?.status === 'processing' && <span>Consultando estado...</span>}
          </div>
        )}

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
          panState={panState}
          loadedTracks={loadedTracks}
          availableTracks={currentSong?.tracks ?? []}
          onToggleMute={toggleMute}
          onSetPan={setTrackPan}
        />

        <Timeline
          currentTime={currentTime}
          duration={duration}
          onSeek={seekTo}
          abLoopEnabled={abLoopEnabled}
          abLoopStart={abLoopStart}
          abLoopEnd={abLoopEnd}
          onToggleAbLoop={toggleAbLoop}
          onClearAbLoop={clearAbLoop}
          onMarkAbLoopPoint={markAbLoopPoint}
        />

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
        <p>Usa el botón de canciones custom o coloca archivos en <code>/public/audio/&lt;slug&gt;/voz.mp3</code>, <code>guitarra.mp3</code>, <code>bajo.mp3</code>, <code>bateria.mp3</code> y opcionalmente <code>lyrics.srt</code></p>
      </footer>

      {isCustomSongModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="custom-song-modal" role="dialog" aria-modal="true" aria-labelledby="custom-song-title">
            <div className="modal-header">
              <div>
                <h2 id="custom-song-title">Agregar canción custom</h2>
                <p>Separa un master con la API o carga stems mp3 ya preparados.</p>
              </div>
              <button type="button" className="modal-close-button" onClick={closeCustomSongModal}>
                Cerrar
              </button>
            </div>

            <div className="custom-song-mode" role="tablist" aria-label="Modo de creación">
              <button
                type="button"
                className={customSongMode === 'separate' ? 'is-active' : ''}
                onClick={() => setCustomSongMode('separate')}
              >
                Separar master
              </button>
              <button
                type="button"
                className={customSongMode === 'manual' ? 'is-active' : ''}
                onClick={() => setCustomSongMode('manual')}
              >
                Cargar stems
              </button>
            </div>

            {customSongMode === 'separate' ? (
              <form className="custom-song-form" onSubmit={handleCreateCustomSong}>
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
                <button
                  type="submit"
                  disabled={customSongStatus.type === 'uploading' || customSongStatus.type === 'processing'}
                >
                  {customSongStatus.type === 'uploading' ? 'Subiendo...' : 'Crear entrada'}
                </button>
              </form>
            ) : (
              <form className="custom-song-form" onSubmit={handleCreateManualSong}>
                <label>
                  Nombre
                  <input
                    type="text"
                    value={manualSongForm.title}
                    onChange={(event) =>
                      setManualSongForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Artista
                  <input
                    type="text"
                    value={manualSongForm.artist}
                    placeholder="Opcional"
                    onChange={(event) =>
                      setManualSongForm((prev) => ({ ...prev, artist: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Tempo
                  <input
                    type="number"
                    min="40"
                    max="220"
                    step="1"
                    value={manualSongForm.tempo}
                    placeholder="Opcional"
                    onChange={(event) =>
                      setManualSongForm((prev) => ({ ...prev, tempo: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Portada
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    onChange={(event) => setManualFile('cover', event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  Voz mp3
                  <input
                    type="file"
                    accept="audio/mpeg,.mp3"
                    onChange={(event) => setManualFile('voz', event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  Guitarra mp3
                  <input
                    type="file"
                    accept="audio/mpeg,.mp3"
                    onChange={(event) => setManualFile('guitarra', event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  Bajo mp3
                  <input
                    type="file"
                    accept="audio/mpeg,.mp3"
                    onChange={(event) => setManualFile('bajo', event.target.files?.[0] ?? null)}
                  />
                </label>
                <label>
                  Batería mp3
                  <input
                    type="file"
                    accept="audio/mpeg,.mp3"
                    onChange={(event) => setManualFile('bateria', event.target.files?.[0] ?? null)}
                  />
                </label>
                <button type="submit" disabled={customSongStatus.type === 'uploading'}>
                  {customSongStatus.type === 'uploading' ? 'Subiendo...' : 'Guardar canción'}
                </button>
              </form>
            )}

            {customSongStatus.message && (
              <div className={`custom-song-status is-${customSongStatus.type}`}>
                <p>{customSongStatus.message}</p>
                {customSongJob?.slug && <small>Slug: {customSongJob.slug}</small>}
              </div>
            )}
          </div>
        </div>
      )}

      {isEditSongModalOpen && currentSong?.custom && (
        <div className="modal-backdrop" role="presentation">
          <div className="custom-song-modal" role="dialog" aria-modal="true" aria-labelledby="edit-song-title">
            <div className="modal-header">
              <div>
                <h2 id="edit-song-title">Editar canción custom</h2>
                <p>Cambia metadata, portada, stems o sube un raw nuevo para volver a separar.</p>
              </div>
              <button type="button" className="modal-close-button" onClick={closeEditSongModal}>
                Cerrar
              </button>
            </div>

            <form className="custom-song-form" onSubmit={handleEditCustomSong}>
              <label>
                Nombre
                <input
                  type="text"
                  value={editSongForm.title}
                  onChange={(event) => setEditSongForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label>
                Artista
                <input
                  type="text"
                  value={editSongForm.artist}
                  onChange={(event) => setEditSongForm((prev) => ({ ...prev, artist: event.target.value }))}
                />
              </label>
              <label>
                Tempo
                <input
                  type="number"
                  min="40"
                  max="220"
                  step="1"
                  value={editSongForm.tempo}
                  placeholder="Opcional"
                  onChange={(event) => setEditSongForm((prev) => ({ ...prev, tempo: event.target.value }))}
                />
              </label>
              <label>
                Portada nueva
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  onChange={(event) => setEditFile('cover', event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Raw nuevo
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,.mp3,.wav,.ogg,.flac"
                  onChange={(event) => setEditFile('raw', event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Voz mp3
                <input
                  type="file"
                  accept="audio/mpeg,.mp3"
                  onChange={(event) => setEditFile('voz', event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Guitarra mp3
                <input
                  type="file"
                  accept="audio/mpeg,.mp3"
                  onChange={(event) => setEditFile('guitarra', event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Bajo mp3
                <input
                  type="file"
                  accept="audio/mpeg,.mp3"
                  onChange={(event) => setEditFile('bajo', event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Batería mp3
                <input
                  type="file"
                  accept="audio/mpeg,.mp3"
                  onChange={(event) => setEditFile('bateria', event.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="submit"
                disabled={customSongStatus.type === 'uploading' || customSongStatus.type === 'processing'}
              >
                {customSongStatus.type === 'uploading' ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button type="button" className="danger-action form-danger-action" onClick={handleDeleteCustomSong}>
                Eliminar canción
              </button>
            </form>

            {customSongStatus.message && (
              <div className={`custom-song-status is-${customSongStatus.type}`}>
                <p>{customSongStatus.message}</p>
                {customSongJob?.slug && <small>Slug: {customSongJob.slug}</small>}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

export default App
