import { TRACK_TYPES } from '../../domain/constants/trackTypes'

/**
 * Mezclador de pistas: muestra un botón por cada stem disponible en la
 * canción actual. Activo = audible, Silenciado = muted.
 */
export function TrackMixer({ muteState, loadedTracks, availableTracks, onToggleMute }) {
  const tracks = TRACK_TYPES.filter((t) => availableTracks.includes(t.id))

  return (
    <section className="track-mixer" aria-label="Mezcla de pistas">
      <p className="track-mixer-label">Pistas</p>
      <div className="track-mixer-grid">
        {tracks.map((track) => {
          const isMuted = muteState[track.id] ?? true
          const isLoaded = loadedTracks[track.id] ?? false

          return (
            <button
              key={track.id}
              type="button"
              className={`track-btn ${isMuted ? 'is-muted' : 'is-active'}`}
              onClick={() => onToggleMute(track.id)}
              title={isMuted ? `Activar ${track.label}` : `Silenciar ${track.label}`}
            >
              <span className="track-btn-name">{track.label}</span>
              <span className="track-btn-indicator" aria-hidden="true">
                {!isLoaded ? '…' : isMuted ? '○' : '●'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
