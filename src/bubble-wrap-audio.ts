type Voice = { source: AudioBufferSourceNode; gain: GainNode }

export function createBubbleWrapAudio() {
  let context: AudioContext | null = null
  let output: GainNode | null = null
  let buffers: AudioBuffer[] = []
  let generation = 0
  const voices = new Set<Voice>()

  function unlock() {
    try {
      if (!context) {
        const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Audio) return
        context = new Audio({ latencyHint: 'interactive' })
        output = context.createGain()
        output.gain.value = 0.55
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -18
        compressor.ratio.value = 8
        compressor.attack.value = 0.002
        compressor.release.value = 0.08
        output.connect(compressor)
        compressor.connect(context.destination)
        // Soft little "bop" variations: a rounded pressure pulse, a few cycles
        // of gentle resonance, and just a trace of the plastic's air snap.
        let seed = 48271
        const profiles = [
          { duration: 0.072, pressure: 0.0014, cutoff: 2600, airDecay: 0.006, snap: 0.09, pitch: 610, bodyDecay: 0.009 },
          { duration: 0.080, pressure: 0.00125, cutoff: 3000, airDecay: 0.0055, snap: 0.11, pitch: 690, bodyDecay: 0.0085 },
          { duration: 0.088, pressure: 0.0016, cutoff: 2400, airDecay: 0.007, snap: 0.08, pitch: 540, bodyDecay: 0.010 },
        ]
        buffers = profiles.map(({ duration, pressure, cutoff, airDecay, snap, pitch, bodyDecay }) => {
          const buffer = context!.createBuffer(1, Math.ceil(context!.sampleRate * duration), context!.sampleRate)
          const samples = buffer.getChannelData(0)
          const rate = context!.sampleRate
          const snapFilter = 1 - Math.exp(-2 * Math.PI * cutoff / rate)
          const airFilter = 1 - Math.exp(-2 * Math.PI * 1800 / rate)
          const lowFilter = 1 - Math.exp(-2 * Math.PI * 280 / rate)
          let bright = 0, air = 0, low = 0, peak = 0
          for (let i = 0; i < samples.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            const noise = seed / 0x80000000 - 1
            const t = i / rate
            bright += snapFilter * (noise - bright)
            air += airFilter * (noise - air)
            low += lowFilter * (noise - low)
            const phase = t / pressure
            const puff = (1 - phase) * Math.exp(-phase)
            const round = (Math.sin(2 * Math.PI * pitch * t) + 0.1 * Math.sin(4 * Math.PI * pitch * t)) * Math.exp(-t / bodyDecay)
            const crack = (bright - low) * Math.exp(-t / 0.0024) * snap
            const release = (air - low) * Math.exp(-t / airDecay) * 0.12
            const edgeFade = Math.min(1, t / 0.0009, (duration - t) / 0.008)
            samples[i] = (puff * 0.42 + round * 0.6 + crack + release) * edgeFade
            peak = Math.max(peak, Math.abs(samples[i]!))
          }
          // Keep the three variants at the same gentle peak level.
          const level = 0.66 / Math.max(peak, 0.001)
          for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * level
          return buffer
        })
      }
      void context.resume().catch(() => {})
    } catch { /* The bubbles remain usable when audio is unavailable. */ }
  }

  function stopVoice(voice: Voice) {
    if (!context || !voices.delete(voice)) return
    voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.004)
    voice.source.stop(context.currentTime + 0.02)
  }

  return {
    unlock,
    play() {
      const audio = context, destination = output
      if (!audio || !destination || !buffers.length) return
      const session = generation, requested = performance.now()
      const play = () => {
        if (session !== generation || audio.state !== 'running' || performance.now() - requested > 200) return
        if (voices.size >= 8) stopVoice(voices.values().next().value!)
        const source = audio.createBufferSource(), gain = audio.createGain()
        source.buffer = buffers[Math.floor(Math.random() * buffers.length)]!
        gain.gain.value = 0.7 / Math.sqrt(Math.max(1, voices.size * 0.6))
        source.connect(gain); gain.connect(destination)
        const voice = { source, gain }
        voices.add(voice)
        source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect() }
        source.start()
      }
      if (audio.state === 'running') play()
      else void audio.resume().then(play).catch(() => {})
    },
    stop() {
      generation++
      for (const voice of voices) stopVoice(voice)
    },
  }
}
