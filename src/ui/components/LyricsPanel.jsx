export function LyricsPanel({ currentLine, nextLine, hasLyrics }) {
  if (!hasLyrics) {
    return null
  }

  return (
    <section className="lyrics-panel" aria-label="Lyrics sincronizadas">
      <p className="lyrics-label">Lyrics</p>
      <p className="lyrics-current">{currentLine || '...'}</p>
      <p className="lyrics-next">{nextLine || ' '}</p>
    </section>
  )
}