function parseTimestampToSeconds(value) {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})$/)
  if (!match) return null

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  )
}

export function parseSrt(rawSrt) {
  if (!rawSrt?.trim()) return []

  return rawSrt
    .trim()
    .replace(/\r/g, '')
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim())
      if (lines.length < 2) return null

      const timeLineIndex = lines[0].includes('-->') ? 0 : 1
      const timeLine = lines[timeLineIndex]
      const [startRaw, endRaw] = timeLine.split('-->').map((part) => part.trim())
      const start = parseTimestampToSeconds(startRaw)
      const end = parseTimestampToSeconds(endRaw)
      const text = lines.slice(timeLineIndex + 1).join(' ').trim()

      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) {
        return null
      }

      return { start, end, text }
    })
    .filter(Boolean)
}