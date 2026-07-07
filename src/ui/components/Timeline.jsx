import { formatSeconds } from '../formatters/time'

export function Timeline({
  currentTime,
  duration,
  onSeek,
  abLoopEnabled,
  abLoopStart,
  abLoopEnd,
  onToggleAbLoop,
  onClearAbLoop,
  onMarkAbLoopPoint,
  checkpoints = [],
  activeCheckpointId = null,
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const hasLoopStart = Number.isFinite(abLoopStart)
  const hasLoopEnd = Number.isFinite(abLoopEnd)
  const loopStartPercent = safeDuration && hasLoopStart ? (abLoopStart / safeDuration) * 100 : 0
  const loopEndPercent = safeDuration && hasLoopEnd ? (abLoopEnd / safeDuration) * 100 : loopStartPercent
  const loopWidthPercent = Math.max(0, loopEndPercent - loopStartPercent)

  function handleTimelineChange(event) {
    const time = Number(event.target.value)
    if (abLoopEnabled) {
      onMarkAbLoopPoint(time)
      return
    }

    onSeek(time)
  }

  return (
    <section className="timeline-panel" aria-label="Posicion de la pista">
      <div className="timeline-controls">
        <button
          type="button"
          className={`ab-loop-button ${abLoopEnabled ? 'is-active' : ''}`}
          onClick={onToggleAbLoop}
        >
          A-B
        </button>
        <button type="button" className="ab-clear-button" onClick={onClearAbLoop} disabled={!hasLoopStart && !hasLoopEnd}>
          Limpiar
        </button>
        <span className="ab-loop-readout">
          A {hasLoopStart ? formatSeconds(abLoopStart) : '--:--'} · B {hasLoopEnd ? formatSeconds(abLoopEnd) : '--:--'}
        </span>
      </div>

      <div className={`timeline ${abLoopEnabled ? 'is-ab-mode' : ''}`}>
        <span>{formatSeconds(currentTime)}</span>
        <div className="timeline-range-wrap">
          {hasLoopStart && (
            <span className="ab-marker is-a" style={{ left: `${loopStartPercent}%` }}>
              A
            </span>
          )}
          {hasLoopEnd && (
            <span className="ab-marker is-b" style={{ left: `${loopEndPercent}%` }}>
              B
            </span>
          )}
          {hasLoopStart && hasLoopEnd && (
            <span
              className="ab-loop-region"
              style={{ left: `${loopStartPercent}%`, width: `${loopWidthPercent}%` }}
            />
          )}
          {safeDuration > 0 && checkpoints.map((checkpoint) => {
            const left = Math.max(0, Math.min(100, (checkpoint.time / safeDuration) * 100))
            return (
              <span
                key={checkpoint.id}
                className={`checkpoint-marker ${activeCheckpointId === checkpoint.id ? 'is-active' : ''}`}
                style={{ left: `${left}%` }}
                title={`${checkpoint.label} ${formatSeconds(checkpoint.time)}`}
              />
            )
          })}
          <input
            type="range"
            min="0"
            max={safeDuration}
            step="0.1"
            value={Math.min(currentTime, safeDuration)}
            onChange={handleTimelineChange}
          />
        </div>
        <span>{formatSeconds(duration)}</span>
      </div>
    </section>
  )
}
