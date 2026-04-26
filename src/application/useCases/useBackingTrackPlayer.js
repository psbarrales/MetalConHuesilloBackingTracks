import { useEffect, useMemo, useRef, useState } from 'react'

import { TRACK_MODES } from '../../domain/constants/trackModes'
import { TrackSelectionService } from '../../domain/services/TrackSelectionService'

export function useBackingTrackPlayer(songRepository) {
  const songs = useMemo(() => songRepository.listSongs(), [songRepository])
  const [currentSongId, setCurrentSongId] = useState(songs[0]?.id ?? null)
  const [currentModeId, setCurrentModeId] = useState(TRACK_MODES[0].id)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.9)

  const audioRef = useRef(null)
  const pendingSeekRef = useRef(0)
  const resumeAfterSwitchRef = useRef(false)

  const currentSong = useMemo(
    () => songs.find((song) => song.id === currentSongId) ?? null,
    [songs, currentSongId],
  )

  const resolvedModeId = TrackSelectionService.resolveMode(currentSong, currentModeId)

  const activeAudioPath = useMemo(
    () => TrackSelectionService.getModeAudioPath(currentSong, resolvedModeId),
    [currentSong, resolvedModeId],
  )

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0)
    }

    const onEnded = () => {
      setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio || !activeAudioPath) {
      return
    }

    const targetTime = pendingSeekRef.current
    const shouldResumePlayback = resumeAfterSwitchRef.current

    const onLoadedMetadata = async () => {
      const maxSeek = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
      audio.currentTime = Math.min(targetTime, maxSeek)
      setCurrentTime(audio.currentTime)
      setDuration(audio.duration || 0)

      if (shouldResumePlayback) {
        try {
          await audio.play()
          setIsPlaying(true)
        } catch {
          setIsPlaying(false)
        }
      }
    }

    audio.src = activeAudioPath
    audio.load()
    audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })

    pendingSeekRef.current = 0
    resumeAfterSwitchRef.current = false

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [activeAudioPath])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  const togglePlayback = async () => {
    const audio = audioRef.current

    if (!audio || !activeAudioPath) {
      return
    }

    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
      }
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  const seekTo = (seconds) => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const boundedTime = Math.min(Math.max(seconds, 0), duration || 0)
    audio.currentTime = boundedTime
    setCurrentTime(boundedTime)
  }

  const seekBy = (secondsDelta) => {
    seekTo(currentTime + secondsDelta)
  }

  const selectSong = (songId) => {
    pendingSeekRef.current = currentTime
    resumeAfterSwitchRef.current = isPlaying
    setCurrentSongId(songId)
  }

  const selectMode = (modeId) => {
    pendingSeekRef.current = currentTime
    resumeAfterSwitchRef.current = isPlaying
    setCurrentModeId(modeId)
  }

  return {
    audioRef,
    songs,
    currentSong,
    currentSongId,
    currentModeId: resolvedModeId,
    isPlaying,
    currentTime,
    duration,
    volume,
    modeOptions: TRACK_MODES,
    selectSong,
    selectMode,
    seekTo,
    seekBy,
    setVolume,
    togglePlayback,
  }
}
