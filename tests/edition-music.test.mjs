import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditionMusic } from '../src/forest-edition/background-music.ts'

test('edition music loops, retries blocked autoplay, and stops outside the example', async () => {
  const previousAudio = globalThis.Audio, previousDocument = globalThis.document
  const document = new EventTarget(); document.hidden = false
  let audio
  class AudioStub {
    constructor(src) { this.src = src; this.paused = true; this.attempts = 0; this.blocked = true; audio = this }
    play() { this.attempts++; if (this.blocked) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve() }
    pause() { this.paused = true }
    removeAttribute() { this.src = '' }
    load() {}
  }
  globalThis.Audio = AudioStub; globalThis.document = document
  const settle = () => new Promise(resolve => setImmediate(resolve))
  let music
  try {
    music = createEditionMusic('/test-background.mp3')
    assert(audio.loop); assert.equal(audio.src, '/test-background.mp3')
    assert.equal(audio.attempts, 0)
    music.start(); await settle(); assert.equal(audio.attempts, 1); assert(audio.paused)
    audio.blocked = false; document.dispatchEvent(new Event('pointerdown')); await settle()
    assert.equal(audio.paused, false)
    document.dispatchEvent(new Event('pointerup')); await settle(); assert.equal(audio.attempts, 2)
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert(audio.paused)
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(audio.paused, false)
    music.stop(); document.dispatchEvent(new Event('pointerdown')); await settle(); assert(audio.paused)
    music.start(); await settle(); assert.equal(audio.paused, false)
    music.stop(); music.start(); music.stop(); await settle(); assert(audio.paused)
    music.dispose(); document.dispatchEvent(new Event('pointerdown')); await settle(); assert(audio.paused)
  } finally {
    music?.dispose(); globalThis.Audio = previousAudio; globalThis.document = previousDocument
  }
})
