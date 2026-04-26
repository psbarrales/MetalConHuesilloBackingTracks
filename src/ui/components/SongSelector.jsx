export function SongSelector({ songs, currentSongId, onSelect }) {
  return (
    <label className="song-selector">
      Cancion
      <select value={currentSongId ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {songs.map((song) => (
          <option key={song.id} value={song.id}>
            {song.title} - {song.artist}
          </option>
        ))}
      </select>
    </label>
  )
}
