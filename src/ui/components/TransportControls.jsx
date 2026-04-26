export function TransportControls({ isPlaying, isPreparing, countIn, onToggle, onBackward, onForward }) {
  const isCounting = countIn !== null
  const isBusy = isPreparing || isCounting

  let playLabel
  let playIcon
  if (isCounting) {
    playLabel = String(countIn)
    playIcon = ''
  } else if (isPreparing) {
    playLabel = 'Cargando...'
    playIcon = '◌'
  } else if (isPlaying) {
    playLabel = 'Pausar'
    playIcon = '❚❚'
  } else {
    playLabel = 'Reproducir'
    playIcon = '▶'
  }

  return (
    <section className="transport-controls" aria-label="Controles de reproduccion">
      <button type="button" onClick={onBackward} disabled={isBusy}>
        -10s
      </button>
      <button
        type="button"
        className={`play-button ${isCounting ? 'is-counting' : ''}`}
        onClick={onToggle}
        disabled={isPreparing}
      >
        {playIcon ? `${playIcon} ${playLabel}` : playLabel}
      </button>
      <button type="button" onClick={onForward} disabled={isBusy}>
        +10s
      </button>
    </section>
  )
}
