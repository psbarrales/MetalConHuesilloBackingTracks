import { formatSeconds } from '../formatters/time'

export function Timeline({ currentTime, duration, onSeek }) {
  return (
    <section className="timeline" aria-label="Posicion de la pista">
      <span>{formatSeconds(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={Number.isFinite(duration) && duration > 0 ? duration : 0}
        step="0.1"
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span>{formatSeconds(duration)}</span>
    </section>
  )
}
