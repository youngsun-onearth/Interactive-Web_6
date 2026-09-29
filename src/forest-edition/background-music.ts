/** One audio element follows the edition's lifecycle, without per-frame work. */
export function createEditionMusic(source: string) {
  const audio = new Audio(source)
  audio.loop = true
  audio.preload = 'auto'
  audio.volume = .45
  let active = false, pending = false, revision = 0, disposed = false

  function play() {
    if (disposed || !active || document.hidden || pending || !audio.paused) return
    pending = true
    const requestedAt = revision
    void audio.play().then(() => {
      if (disposed || !active || document.hidden) audio.pause()
    }).catch(() => {
      // Autoplay can be blocked until a real gesture. Retry on that gesture,
      // rather than continuously restarting the audio or reporting an error.
    }).finally(() => {
      pending = false
      if (revision !== requestedAt) play()
    })
  }
  function visibilityChanged() {
    revision++
    if (document.hidden) audio.pause()
    else play()
  }
  const gestures = ['pointerdown', 'pointerup', 'keydown'] as const
  for (const event of gestures) document.addEventListener(event, play, true)
  document.addEventListener('visibilitychange', visibilityChanged)

  return {
    start() { active = true; revision++; play() },
    stop() { active = false; revision++; audio.pause() },
    dispose() {
      disposed = true; active = false; revision++; audio.pause()
      for (const event of gestures) document.removeEventListener(event, play, true)
      document.removeEventListener('visibilitychange', visibilityChanged)
      audio.removeAttribute('src'); audio.load()
    },
  }
}
