export function ModeSelector({ currentModeId, songsCurrentModes, modeOptions, onSelect }) {
  return (
    <section className="mode-selector" aria-label="Tipos de backing track">
      {modeOptions.map((mode) => {
        const unavailable = !songsCurrentModes.includes(mode.id)
        const selected = currentModeId === mode.id

        return (
          <button
            key={mode.id}
            type="button"
            className={selected ? 'is-selected' : ''}
            onClick={() => onSelect(mode.id)}
            disabled={unavailable}
            title={mode.description}
          >
            {mode.label}
          </button>
        )
      })}
    </section>
  )
}
