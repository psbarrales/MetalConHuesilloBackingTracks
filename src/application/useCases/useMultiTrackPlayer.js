import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TRACK_TYPE_BY_ID, TRACK_TYPES } from '../../domain/constants/trackTypes'
import { metronomeEngine } from '../../domain/services/MetronomeEngine'

/** Deriva mayor a este umbral activa la corrección de sincronía */
const SYNC_THRESHOLD_S = 0.12

/** Pista que actúa como reloj maestro (se prefiere 'voz') */
const PREFERRED_MASTER = 'voz'

const MIN_BPM = 40
const MAX_BPM = 220
const READY_STATE_ENOUGH_DATA = 4
const TRACK_READY_TIMEOUT_MS = 15000
const LAST_SONG_STORAGE_KEY = 'backingtrack:last-song-id'

function clampBpm(value) {
  if (!Number.isFinite(value)) return 120
  return Math.min(MAX_BPM, Math.max(MIN_BPM, value))
}

function computePlaybackRate(baseBpm, targetBpm) {
  const safeBase = clampBpm(baseBpm)
  const safeTarget = clampBpm(targetBpm)
  return safeTarget / safeBase
}

function waitForTrackReady(audio, timeoutMs = TRACK_READY_TIMEOUT_MS) {
  if (audio.readyState >= READY_STATE_ENOUGH_DATA) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeout)
      audio.removeEventListener('canplaythrough', onReady)
      audio.removeEventListener('error', onError)
      resolve()
    }

    const onError = () => {
      clearTimeout(timeout)
      audio.removeEventListener('canplaythrough', onReady)
      audio.removeEventListener('error', onError)
      reject(new Error('No se pudo cargar una pista.'))
    }

    const timeout = setTimeout(() => {
      audio.removeEventListener('canplaythrough', onReady)
      audio.removeEventListener('error', onError)
      reject(new Error('Timeout esperando la carga completa de una pista.'))
    }, timeoutMs)

    audio.addEventListener('canplaythrough', onReady, { once: true })
    audio.addEventListener('error', onError, { once: true })
    audio.load()
  })
}

function buildInitialMuteState() {
  return Object.fromEntries(TRACK_TYPES.map((t) => [t.id, t.defaultMuted]))
}

export function useMultiTrackPlayer(songRepository) {
  const songs = useMemo(() => songRepository.listSongs(), [songRepository])
  const [currentSongId, setCurrentSongId] = useState(() => {
    if (typeof window === 'undefined') {
      return songs[0]?.id ?? null
    }

    const persistedSongId = window.localStorage.getItem(LAST_SONG_STORAGE_KEY)
    const persistedSongExists = songs.some((song) => song.id === persistedSongId)

    if (persistedSongId && persistedSongExists) {
      return persistedSongId
    }

    return songs[0]?.id ?? null
  })
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [targetBpm, setTargetBpm] = useState(() => clampBpm(songs[0]?.bpm ?? 120))
  const [volume, setVolume] = useState(0.9)
  const [muteState, setMuteState] = useState(buildInitialMuteState)
  const [loadedTracks, setLoadedTracks] = useState({})
  const [isPreparingPlayback, setIsPreparingPlayback] = useState(false)
  /** Cuenta regresiva: 4 | 3 | 2 | 1 | null */
  const [countIn, setCountIn] = useState(null)

  const audioElementsRef = useRef({})
  const masterIdRef = useRef(PREFERRED_MASTER)
  const animFrameRef = useRef(null)
  const isPlayingRef = useRef(false)
  const isCountingInRef = useRef(false)
  const countInTimersRef = useRef([])

  const muteStateRef = useRef(muteState)
  const volumeRef = useRef(volume)
  const currentSongRef = useRef(null)
  const playbackRateRef = useRef(1)

  useEffect(() => {
    muteStateRef.current = muteState
  }, [muteState])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  const currentSong = useMemo(
    () => songs.find((s) => s.id === currentSongId) ?? null,
    [songs, currentSongId],
  )

  useEffect(() => {
    if (!songs.length) {
      return
    }

    const songStillExists = songs.some((song) => song.id === currentSongId)

    if (!songStillExists) {
      setCurrentSongId(songs[0].id)
    }
  }, [currentSongId, songs])

  useEffect(() => {
    if (typeof window === 'undefined' || !currentSongId) {
      return
    }

    window.localStorage.setItem(LAST_SONG_STORAGE_KEY, currentSongId)
  }, [currentSongId])

  const baseBpm = clampBpm(currentSong?.bpm ?? 120)
  const effectiveTargetBpm = clampBpm(targetBpm)
  const playbackRate = useMemo(
    () => computePlaybackRate(baseBpm, effectiveTargetBpm),
    [baseBpm, effectiveTargetBpm],
  )

  const updateTargetBpm = useCallback((nextBpm) => {
    setTargetBpm((prev) => {
      if (!Number.isFinite(nextBpm)) return prev
      return clampBpm(nextBpm)
    })
  }, [])

  useEffect(() => {
    currentSongRef.current = currentSong
  }, [currentSong])

  useEffect(() => {
    playbackRateRef.current = playbackRate
  }, [playbackRate])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  // ─── Crea / recrea los elementos <audio> al cambiar de canción ─────────────
  useEffect(() => {
    if (!currentSong) return

    setTargetBpm(clampBpm(currentSong.bpm ?? 120))

    // Limpia conteo y reproducción previos
    for (const t of countInTimersRef.current) clearTimeout(t)
    countInTimersRef.current = []
    isCountingInRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    metronomeEngine.stop()

    for (const audio of Object.values(audioElementsRef.current)) {
      audio.pause()
      audio.src = ''
    }

    setIsPlaying(false)
    setIsPreparingPlayback(false)
    setCountIn(null)
    setCurrentTime(0)
    setDuration(0)
    setLoadedTracks({})
    metronomeEngine.setMuted(muteStateRef.current.metronomo ?? true)

    const elements = {}
    const masterId = currentSong.tracks.includes(PREFERRED_MASTER)
      ? PREFERRED_MASTER
      : currentSong.tracks.find((t) => !TRACK_TYPE_BY_ID[t]?.synthetic) ?? currentSong.tracks[0]
    masterIdRef.current = masterId

    for (const trackId of currentSong.tracks) {
      // Los tracks sintéticos (metrónomo) no tienen archivo de audio
      if (TRACK_TYPE_BY_ID[trackId]?.synthetic) continue

      const audio = new Audio()
      audio.preload = 'auto'
      audio.volume = (muteStateRef.current[trackId] ?? true) ? 0 : volumeRef.current
      audio.playbackRate = playbackRateRef.current
      audio.src = `/audio/${currentSong.slug}/${trackId}.mp3`

      audio.addEventListener(
        'loadedmetadata',
        () => {
          setDuration((prev) => Math.max(prev, audio.duration || 0))
        },
        { once: true },
      )

      audio.addEventListener(
        'canplaythrough',
        () => {
          setLoadedTracks((prev) => ({ ...prev, [trackId]: true }))
        },
        { once: true },
      )

      elements[trackId] = audio
    }

    // El track maestro controla el fin de la reproducción
    const masterAudio = elements[masterId]
    if (masterAudio) {
      masterAudio.addEventListener('ended', () => {
        cancelAnimationFrame(animFrameRef.current)
        metronomeEngine.stop()
        for (const audio of Object.values(elements)) {
          audio.pause()
          audio.currentTime = 0
        }
        setIsPlaying(false)
        setCurrentTime(0)
      })
    }

    audioElementsRef.current = elements

    return () => {
      for (const t of countInTimersRef.current) clearTimeout(t)
      countInTimersRef.current = []
      cancelAnimationFrame(animFrameRef.current)
      metronomeEngine.stop()
      for (const audio of Object.values(elements)) {
        audio.pause()
        audio.src = ''
      }
      audioElementsRef.current = {}
    }
    // Solo se recrea cuando cambia la canción
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id])

  // ─── Propaga cambios de volumen (gain por pista) ──────────────────────────
  useEffect(() => {
    for (const [trackId, audio] of Object.entries(audioElementsRef.current)) {
      const isMuted = muteState[trackId] ?? true
      audio.volume = isMuted ? 0 : volume
    }
  }, [muteState, volume])

  // ─── Propaga cambios de playbackRate ───────────────────────────────────────
  useEffect(() => {
    const elements = audioElementsRef.current
    const master = elements[masterIdRef.current]
    const mediaPosition = master?.currentTime ?? 0

    for (const audio of Object.values(elements)) {
      audio.playbackRate = playbackRate
    }

    if (isPlayingRef.current) {
      metronomeEngine.stop()
      const metronomePosition = mediaPosition / playbackRate
      metronomeEngine.start(effectiveTargetBpm, metronomePosition)
    }
  }, [effectiveTargetBpm, playbackRate])

  // ─── Loop de seguimiento de tiempo + corrección de deriva ─────────────────
  const startTimeTracking = useCallback(() => {
    const tick = () => {
      const master = audioElementsRef.current[masterIdRef.current]
      if (master) {
        setCurrentTime(master.currentTime)

        // Corrige deriva de las pistas secundarias
        for (const [id, audio] of Object.entries(audioElementsRef.current)) {
          if (id !== masterIdRef.current && !audio.paused && !audio.ended) {
            const drift = Math.abs(audio.currentTime - master.currentTime)
            if (drift > SYNC_THRESHOLD_S) {
              audio.currentTime = master.currentTime
            }
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const stopTimeTracking = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  // ─── Acciones de transporte ────────────────────────────────────────────────
  const togglePlayback = useCallback(async () => {
    const elements = audioElementsRef.current

    // Cancelar cuenta regresiva en curso
    if (isCountingInRef.current) {
      isCountingInRef.current = false
      for (const t of countInTimersRef.current) clearTimeout(t)
      countInTimersRef.current = []
      setCountIn(null)
      return
    }

    if (isPlaying) {
      for (const audio of Object.values(elements)) audio.pause()
      metronomeEngine.stop()
      stopTimeTracking()
      setIsPlaying(false)
      setIsPreparingPlayback(false)
      return
    }

    if (!Object.keys(elements).length) return

    setIsPreparingPlayback(true)
    try {
      await Promise.all(Object.values(elements).map((audio) => waitForTrackReady(audio)))
    } catch (err) {
      console.error('No se pudo preparar la reproducción:', err)
      setIsPreparingPlayback(false)
      return
    }
    setIsPreparingPlayback(false)

    const bpm = effectiveTargetBpm
    const masterAudio = elements[masterIdRef.current]
    const position = masterAudio?.currentTime ?? 0
    const isFromStart = position < 0.1

    if (isFromStart) {
      // ── Cuenta regresiva ────────────────────────────────────────────────
      isCountingInRef.current = true
      const { delayMs, beatTimingsMs } = metronomeEngine.countIn(bpm, 4)

      const timers = []
      beatTimingsMs.forEach((ms, i) => {
        timers.push(setTimeout(() => setCountIn(4 - i), ms))
      })
      timers.push(
        setTimeout(async () => {
          if (!isCountingInRef.current) return
          isCountingInRef.current = false
          setCountIn(null)

          for (const audio of Object.values(elements)) audio.currentTime = 0
          try {
            await Promise.all(Object.values(elements).map((a) => a.play()))
            metronomeEngine.start(bpm, 0)
            startTimeTracking()
            setIsPlaying(true)
          } catch (err) {
            console.error('Error al reproducir tras cuenta regresiva:', err)
            setIsPlaying(false)
          }
        }, delayMs),
      )
      countInTimersRef.current = timers
    } else {
      // ── Reanuda desde posición actual ───────────────────────────────────
      for (const audio of Object.values(elements)) audio.currentTime = position
      try {
        await Promise.all(Object.values(elements).map((a) => a.play()))
        const metronomePosition = position / playbackRateRef.current
        metronomeEngine.start(bpm, metronomePosition)
        startTimeTracking()
        setIsPlaying(true)
      } catch (err) {
        console.error('Error al reanudar:', err)
        setIsPlaying(false)
      }
    }
  }, [effectiveTargetBpm, isPlaying, startTimeTracking, stopTimeTracking])

  const seekTo = useCallback((time) => {
    for (const audio of Object.values(audioElementsRef.current)) {
      audio.currentTime = time
    }
    setCurrentTime(time)
    if (isPlayingRef.current) {
      const bpm = effectiveTargetBpm
      metronomeEngine.stop()
      const metronomePosition = time / playbackRateRef.current
      metronomeEngine.start(bpm, metronomePosition)
    }
  }, [effectiveTargetBpm])

  const seekBy = useCallback(
    (delta) => {
      const master = audioElementsRef.current[masterIdRef.current]
      if (!master) return
      const clamped = Math.max(0, Math.min(master.currentTime + delta, duration))
      seekTo(clamped)
    },
    [duration, seekTo],
  )

  const toggleMute = useCallback((trackId) => {
    if (trackId === 'metronomo') {
      setMuteState((prev) => {
        const newMuted = !prev[trackId]
        metronomeEngine.setMuted(newMuted)
        return { ...prev, [trackId]: newMuted }
      })
    } else {
      setMuteState((prev) => ({ ...prev, [trackId]: !prev[trackId] }))
    }
  }, [])

  const selectSong = useCallback((songId) => {
    setCurrentSongId(songId)
  }, [])

  return {
    songs,
    currentSong,
    currentSongId,
    isPlaying,
    isPreparingPlayback,
    countIn,
    baseBpm,
    targetBpm: effectiveTargetBpm,
    playbackRate,
    currentTime,
    duration,
    volume,
    muteState,
    loadedTracks,
    selectSong,
    togglePlayback,
    seekTo,
    seekBy,
    setTargetBpm: updateTargetBpm,
    setVolume,
    toggleMute,
  }
}
