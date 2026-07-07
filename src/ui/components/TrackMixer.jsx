import { TRACK_TYPES } from '../../domain/constants/trackTypes'

/**
 * Mezclador de pistas: muestra un botón por cada stem disponible en la
 * canción actual. Activo = audible, Silenciado = muted.
 */
const PAN_OPTIONS = [
  { id: 'left', label: 'L' },
  { id: 'stereo', label: 'S' },
  { id: 'right', label: 'R' },
]

export function TrackMixer({ muteState, panState, loadedTracks, availableTracks, onToggleMute, onSetPan }) {
  const tracks = TRACK_TYPES.filter((t) => availableTracks.includes(t.id))

  return (
    <section className="track-mixer" aria-label="Mezcla de pistas">
      <p className="track-mixer-label">Pistas</p>
      <div className="track-mixer-grid">
        {tracks.map((track) => {
          const isMuted = muteState[track.id] ?? true
          const isLoaded = loadedTracks[track.id] ?? false
          const panMode = panState[track.id] ?? 'stereo'

          return (
            <div key={track.id} className={`track-card ${isMuted ? 'is-muted' : 'is-active'}`}>
              <button
                type="button"
                className="track-btn"
                onClick={() => onToggleMute(track.id)}
                title={isMuted ? `Activar ${track.label}` : `Silenciar ${track.label}`}
              >
                <span className="track-btn-name">{track.label}</span>
                <span className="track-btn-indicator" aria-hidden="true">
                  {!isLoaded ? '…' : isMuted ? '○' : '●'}
                </span>
              </button>

              <div className="track-pan-controls" aria-label={`Paneo de ${track.label}`}>
                {PAN_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={panMode === option.id ? 'is-selected' : ''}
                    onClick={() => onSetPan(track.id, option.id)}
                    title={`Pan ${option.label} para ${track.label}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
