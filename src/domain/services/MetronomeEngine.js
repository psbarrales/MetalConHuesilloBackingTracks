/**
 * MetronomeEngine — genera clicks de baqueta via Web Audio API.
 *
 * Características:
 *  - Scheduler look-ahead (25 ms) para timing preciso sin drift de setInterval.
 *  - Acento en el primer tiempo del compás (4/4).
 *  - countIn(): genera N clicks de cuenta regresiva y devuelve los timings
 *    para actualizar la UI, más el delay en ms hasta que debe arrancar el audio.
 *  - start(): sincroniza el metrónomo con la posición actual de la canción.
 *  - setMuted(): activa/silencia el metrónomo en tiempo real.
 */

const LOOKAHEAD_MS = 25      // intervalo del scheduler
const SCHEDULE_AHEAD_S = 0.1  // ventana de anticipación en segundos
const START_OFFSET_S = 0.08   // retardo mínimo antes del primer click (80 ms)

function _makeClick(ctx, time, isAccent, destNode) {
  const size = Math.floor(ctx.sampleRate * 0.04)
  const buf = ctx.createBuffer(1, size, ctx.sampleRate)
  const d = buf.getChannelData(0)
  const tau = ctx.sampleRate * (isAccent ? 0.007 : 0.004)
  for (let i = 0; i < size; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / tau)
  }
  const src = ctx.createBufferSource()
  src.buffer = buf

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = isAccent ? 1400 : 1000

  const g = ctx.createGain()
  g.gain.value = isAccent ? 0.9 : 0.6

  src.connect(hpf)
  hpf.connect(g)
  g.connect(destNode)
  src.start(time)
}

class MetronomeEngine {
  constructor() {
    this._ctx = null
    this._masterGain = null
    this._interval = null
    this._nextBeatTime = 0
    this._beatCount = 0
    this._bpm = 120
    this._muted = true
  }

  _ensure({ resume = true } = {}) {
    if (!this._ctx || this._ctx.state === 'closed') {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)()
      this._masterGain = this._ctx.createGain()
      this._masterGain.gain.value = this._muted ? 0 : 1
      this._masterGain.connect(this._ctx.destination)
    }
    if (resume && this._ctx.state === 'suspended') {
      this._ctx.resume()
    }
    return this._ctx
  }

  /**
   * Intenta desbloquear el AudioContext tras un gesto del usuario.
   */
  async unlock() {
    const ctx = this._ensure({ resume: false })
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Ignora: el navegador puede seguir bloqueando hasta otro gesto válido.
      }
    }
  }

  _loop() {
    const ctx = this._ctx
    const spb = 60 / this._bpm
    while (this._nextBeatTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const isAccent = this._beatCount % 4 === 0
      _makeClick(ctx, this._nextBeatTime, isAccent, this._masterGain)
      this._nextBeatTime += spb
      this._beatCount++
    }
  }

  /** Silencia o activa el metrónomo sin detenerlo. */
  setMuted(muted) {
    this._muted = muted
    if (this._masterGain) {
      this._masterGain.gain.value = muted ? 0 : 1
    }
  }

  /**
   * Programa N clicks de cuenta regresiva (siempre audibles, ignoran mute).
   * Devuelve:
   *   - delayMs: milisegundos hasta que debe arrancar el audio
   *   - beatTimingsMs: array con el momento en ms (desde ahora) de cada click
   */
  countIn(bpm, beats = 4) {
    const ctx = this._ensure()
    const spb = 60 / bpm
    const startTime = ctx.currentTime + START_OFFSET_S

    // Gain independiente del master (count-in siempre suena)
    const ciGain = ctx.createGain()
    ciGain.gain.value = 1
    ciGain.connect(ctx.destination)

    for (let i = 0; i < beats; i++) {
      _makeClick(ctx, startTime + i * spb, i === 0, ciGain)
    }

    const nowCtx = ctx.currentTime
    const beatTimingsMs = Array.from({ length: beats }, (_, i) =>
      (startTime + i * spb - nowCtx) * 1000,
    )
    const delayMs = (startTime + beats * spb - nowCtx) * 1000

    return { delayMs, beatTimingsMs }
  }

  /**
   * Arranca el loop del metrónomo sincronizado con la posición de la canción.
   * @param {number} bpm
   * @param {number} songPositionS — posición actual en segundos
   */
  start(bpm, songPositionS = 0) {
    const ctx = this._ensure()
    this._bpm = bpm
    clearInterval(this._interval)

    const spb = 60 / bpm
    // Calcula cuándo cae el siguiente tiempo de la canción
    const currentBeat = Math.floor(songPositionS / spb)
    const nextBeatSongTime = (currentBeat + 1) * spb
    const offsetToNext = nextBeatSongTime - songPositionS

    this._beatCount = (currentBeat + 1) % 4
    this._nextBeatTime = ctx.currentTime + offsetToNext

    this._loop()
    this._interval = setInterval(() => this._loop(), LOOKAHEAD_MS)
  }

  stop() {
    clearInterval(this._interval)
    this._interval = null
  }
}

export const metronomeEngine = new MetronomeEngine()
