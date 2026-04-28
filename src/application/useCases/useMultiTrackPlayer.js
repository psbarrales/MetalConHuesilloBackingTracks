import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TRACK_TYPE_BY_ID, TRACK_TYPES } from '../../domain/constants/trackTypes'
import { metronomeEngine } from '../../domain/services/MetronomeEngine'

/** Deriva mayor a este umbral activa la corrección de sincronía */
const SYNC_THRESHOLD_S = 0.12
const HARD_RESYNC_THRESHOLD_S = 0.2
const RESYNC_INTERVAL_MS = 1000

/** Pista que actúa como reloj maestro (se prefiere 'voz') */
const PREFERRED_MASTER = 'voz'

const MIN_BPM = 40
const MAX_BPM = 220
const MIN_SEMITONES = -6
const MAX_SEMITONES = 6
const READY_STATE_ENOUGH_DATA = 4
const TRACK_READY_TIMEOUT_MS = 15000
const METRONOME_PROBE_TIMEOUT_MS = 2500
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

function clampSemitones(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, Math.round(value)))
}

function semitonesToRate(semitones) {
  return 2 ** (semitones / 12)
}

function isTonalTrack(trackId) {
  return trackId === 'voz' || trackId === 'guitarra' || trackId === 'bajo'
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

function probeAudioTrack(url, timeoutMs = METRONOME_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const probe = new Audio()
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      probe.removeEventListener('loadedmetadata', onReady)
      probe.removeEventListener('canplaythrough', onReady)
      probe.removeEventListener('error', onError)
      probe.pause()
      probe.src = ''
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onReady = () => finish(true)
    const onError = () => finish(false)

    const timeout = setTimeout(() => finish(false), timeoutMs)

    probe.preload = 'metadata'
    probe.addEventListener('loadedmetadata', onReady, { once: true })
    probe.addEventListener('canplaythrough', onReady, { once: true })
    probe.addEventListener('error', onError, { once: true })
    probe.src = url
    probe.load()
  })
}

function buildInitialMuteState() {
  return Object.fromEntries(TRACK_TYPES.map((t) => [t.id, t.defaultMuted]))
}

function applyTrackOutput(audio, isMuted, volume) {
  // `muted` es más confiable en iOS/Android que depender solo de `volume = 0`.
  audio.muted = Boolean(isMuted)
  audio.volume = isMuted ? 0 : volume
}

function applyTrackPitchBehavior(audio, trackId, pitchSemitones) {
  const shouldKeepPitch = !isTonalTrack(trackId) || pitchSemitones === 0

  if ('preservesPitch' in audio) {
    audio.preservesPitch = shouldKeepPitch
  }
  if ('webkitPreservesPitch' in audio) {
    audio.webkitPreservesPitch = shouldKeepPitch
  }
  if ('mozPreservesPitch' in audio) {
    audio.mozPreservesPitch = shouldKeepPitch
  }
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
  const [pitchSemitones, setPitchSemitones] = useState(0)
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
  const syncIntervalRef = useRef(null)
  const useAudioMetronomeRef = useRef(false)

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
  const tempoPlaybackRate = useMemo(
    () => computePlaybackRate(baseBpm, effectiveTargetBpm),
    [baseBpm, effectiveTargetBpm],
  )
  const effectivePitchSemitones = useMemo(() => clampSemitones(pitchSemitones), [pitchSemitones])
  const pitchRate = useMemo(() => semitonesToRate(effectivePitchSemitones), [effectivePitchSemitones])
  const playbackRate = useMemo(() => tempoPlaybackRate * pitchRate, [tempoPlaybackRate, pitchRate])
  const metronomeBpm = useMemo(() => effectiveTargetBpm * pitchRate, [effectiveTargetBpm, pitchRate])

  const updateTargetBpm = useCallback((nextBpm) => {
    setTargetBpm((prev) => {
      if (!Number.isFinite(nextBpm)) return prev
      return clampBpm(nextBpm)
    })
  }, [])

  const updatePitchSemitones = useCallback((nextSemitones) => {
    setPitchSemitones((prev) => {
      if (!Number.isFinite(nextSemitones)) return prev
      return clampSemitones(nextSemitones)
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
    let cancelled = false

    const initSongAudios = async () => {
    if (!currentSong) return

    setTargetBpm(clampBpm(currentSong.bpm ?? 120))

    // Limpia conteo y reproducción previos
    for (const t of countInTimersRef.current) clearTimeout(t)
    countInTimersRef.current = []
    isCountingInRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    clearInterval(syncIntervalRef.current)
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
    useAudioMetronomeRef.current = false
    metronomeEngine.setMuted(muteStateRef.current.metronomo ?? true)

    const elements = {}
    const masterId = currentSong.tracks.includes(PREFERRED_MASTER)
      ? PREFERRED_MASTER
      : currentSong.tracks.find((t) => !TRACK_TYPE_BY_ID[t]?.synthetic) ?? currentSong.tracks[0]
    masterIdRef.current = masterId

    const metronomeTrackUrl = `/audio/${currentSong.slug}/metronomo.mp3`
    const hasMetronomeAudio = currentSong.tracks.includes('metronomo')
      ? await probeAudioTrack(metronomeTrackUrl)
      : false

    if (cancelled) return
    useAudioMetronomeRef.current = hasMetronomeAudio

    for (const trackId of currentSong.tracks) {
      // Usa metrónomo sintético solo si no existe archivo metronomo.mp3.
      if (trackId === 'metronomo' && !hasMetronomeAudio) continue
      if (trackId !== 'metronomo' && TRACK_TYPE_BY_ID[trackId]?.synthetic) continue

      const audio = new Audio()
      audio.preload = 'auto'
      applyTrackOutput(audio, muteStateRef.current[trackId] ?? true, volumeRef.current)
      applyTrackPitchBehavior(audio, trackId, effectivePitchSemitones)
      audio.playbackRate = playbackRateRef.current
      audio.src = trackId === 'metronomo' ? metronomeTrackUrl : `/audio/${currentSong.slug}/${trackId}.mp3`

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

    if (hasMetronomeAudio) {
      setLoadedTracks((prev) => ({ ...prev, metronomo: true }))
    }

    }

    initSongAudios()

    return () => {
      cancelled = true
      for (const t of countInTimersRef.current) clearTimeout(t)
      countInTimersRef.current = []
      cancelAnimationFrame(animFrameRef.current)
      clearInterval(syncIntervalRef.current)
      metronomeEngine.stop()
      useAudioMetronomeRef.current = false
      for (const audio of Object.values(audioElementsRef.current)) {
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
      applyTrackOutput(audio, isMuted, volume)
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

    for (const [trackId, audio] of Object.entries(elements)) {
      applyTrackPitchBehavior(audio, trackId, effectivePitchSemitones)
    }

    if (isPlayingRef.current && !useAudioMetronomeRef.current) {
      metronomeEngine.stop()
      const metronomePosition = mediaPosition / playbackRate
      metronomeEngine.start(metronomeBpm, metronomePosition)
    }
  }, [effectivePitchSemitones, metronomeBpm, playbackRate])

  // ─── Loop de seguimiento de tiempo + corrección de deriva ─────────────────
  const syncSlaveTracks = useCallback((thresholdS) => {
    const master = audioElementsRef.current[masterIdRef.current]
    if (!master) return

    for (const [id, audio] of Object.entries(audioElementsRef.current)) {
      if (id === masterIdRef.current || audio.ended) continue

      const drift = Math.abs(audio.currentTime - master.currentTime)
      if (drift > thresholdS) {
        audio.currentTime = master.currentTime
      }

      // Si alguna pista se queda pausada por el navegador, la relanza.
      if (isPlayingRef.current && audio.paused) {
        audio
          .play()
          .catch(() => {
            // Ignora rechazos transitorios; el próximo ciclo volverá a intentar.
          })
      }
    }
  }, [])

  const startTimeTracking = useCallback(() => {
    clearInterval(syncIntervalRef.current)

    const tick = () => {
      const master = audioElementsRef.current[masterIdRef.current]
      if (master) {
        setCurrentTime(master.currentTime)
        syncSlaveTracks(SYNC_THRESHOLD_S)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }

    syncIntervalRef.current = setInterval(() => {
      syncSlaveTracks(HARD_RESYNC_THRESHOLD_S)
    }, RESYNC_INTERVAL_MS)

    animFrameRef.current = requestAnimationFrame(tick)
  }, [syncSlaveTracks])

  const stopTimeTracking = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    clearInterval(syncIntervalRef.current)
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
      if (!useAudioMetronomeRef.current) metronomeEngine.stop()
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

    const bpm = metronomeBpm
    const useAudioMetronome = useAudioMetronomeRef.current
    const masterAudio = elements[masterIdRef.current]
    const position = masterAudio?.currentTime ?? 0
    const isFromStart = position < 0.1

    if (!useAudioMetronome) {
      await metronomeEngine.unlock()
    }

    if (isFromStart && !useAudioMetronome) {
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
        if (!useAudioMetronome) {
          const metronomePosition = position / playbackRateRef.current
          metronomeEngine.start(bpm, metronomePosition)
        }
        startTimeTracking()
        setIsPlaying(true)
      } catch (err) {
        console.error('Error al reanudar:', err)
        setIsPlaying(false)
      }
    }
  }, [isPlaying, metronomeBpm, startTimeTracking, stopTimeTracking])

  const seekTo = useCallback((time) => {
    for (const audio of Object.values(audioElementsRef.current)) {
      audio.currentTime = time
    }
    setCurrentTime(time)
    if (isPlayingRef.current) {
      const bpm = metronomeBpm
      if (!useAudioMetronomeRef.current) {
        metronomeEngine.stop()
        const metronomePosition = time / playbackRateRef.current
        metronomeEngine.start(bpm, metronomePosition)
      }
    }
  }, [metronomeBpm])

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
        if (!useAudioMetronomeRef.current) {
          metronomeEngine.setMuted(newMuted)
        }
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
    pitchSemitones: effectivePitchSemitones,
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
    setPitchSemitones: updatePitchSemitones,
    setVolume,
    toggleMute,
  }
}
