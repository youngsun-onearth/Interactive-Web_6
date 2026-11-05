import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

// Exercise the actual input and animation code without a browser or server.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/fireworks.ts', import.meta.url), 'utf8'))
  .replace('export function createFireworks', 'function createFireworks')

function setup({ captureFails = false } = {}) {
  class Surface {
    listeners = new Map()
    captured = new Set()
    addEventListener(type, callback, options) {
      const listeners = this.listeners.get(type) ?? []
      listeners.push({ callback, capture: options === true || options?.capture === true })
      this.listeners.set(type, listeners)
    }
    hasPointerCapture(id) { return this.captured.has(id) }
    setPointerCapture(id) {
      if (captureFails) throw new Error('Capture unavailable')
      this.captured.add(id)
    }
    releasePointerCapture(id) { this.captured.delete(id) }
    closest() { return null }
  }
  const window = new Surface(), stage = new Surface(), document = new Surface()
  Object.assign(window, { innerWidth: 1280, innerHeight: 900 })
  Object.assign(document, { hidden: false, fonts: { ready: Promise.resolve() } })
  let now = 1000, nextFrame = 0, lineStart
  const frames = new Map(), centers = []
  const ctx = {
    clearRect() {}, setTransform() {}, beginPath() {}, stroke() {}, arc() {}, fill() {}, fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    moveTo(x, y) { lineStart = { x, y } },
    lineTo(x, y) {
      // Newly born sparks have a zero-length trail at their explosion origin.
      if (lineStart?.x === x && lineStart?.y === y) centers.push({ x, y, at: now })
    },
  }
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 0, height: 0 }) }
  const context = vm.createContext({
    window, document, Element: Surface, devicePixelRatio: 1,
    performance: { now: () => now }, matchMedia: () => ({ matches: false }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame(id) { frames.delete(id) },
  })
  vm.runInContext(source, context)
  const fireworks = context.createFireworks(stage, { querySelector: () => canvas })
  fireworks.setActive(true)
  function send(type, x, y, { blocked = false, pointerId = 1, pointerType = 'mouse' } = {}) {
    const event = { clientX: x, clientY: y, pointerId, pointerType, button: 0, target: stage, preventDefault() {} }
    for (const listener of window.listeners.get(type) ?? []) if (listener.capture) listener.callback(event)
    if (blocked) return // A navigation control stops propagation at the target.
    for (const listener of stage.listeners.get(type) ?? []) listener.callback(event)
    for (const listener of window.listeners.get(type) ?? []) if (!listener.capture) listener.callback(event)
  }
  function advance(milliseconds) {
    now += milliseconds
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(now))
  }
  return { stage, fireworks, send, advance, centers }
}

for (const pointerType of ['mouse', 'touch']) {
  test(`${pointerType}: lost capture preserves the bent path and release starts an ordered chain`, () => {
    const app = setup()
    const send = (type, x, y, extra) => app.send(type, x, y, { pointerType, ...extra })
    send('pointerdown', 180, 250)
    send('pointermove', 620, 250)
    app.stage.releasePointerCapture(1)
    send('lostpointercapture', 620, 250)
    send('pointermove', 620, 650, { blocked: true })
    assert.equal(app.centers.length, 0, 'wait for release before exploding')
    send('pointerup', 620, 650, { blocked: true })
    app.advance(0)
    for (let i = 0; i < 16; i++) app.advance(70)
    const centers = [...new Map(app.centers.map(point => [point.at, point])).values()]
    assert(centers.length > 5, 'multiple explosions are scheduled')
    assert.deepEqual(centers[0], { x: 180, y: 250, at: 1000 })
    assert.equal(centers.at(-1).x, 620)
    assert.equal(centers.at(-1).y, 650)
    assert(centers.every(point => point.y === 250 || point.x === 620), 'follow the bend, not a diagonal shortcut')
    assert(centers.every((point, index) => !index || point.at > centers[index - 1].at))
  })
}

test('drag still works when pointer capture is unavailable', () => {
  const app = setup({ captureFails: true })
  app.send('pointerdown', 100, 300)
  app.send('pointermove', 700, 300, { blocked: true })
  app.send('pointerup', 700, 300, { blocked: true })
  app.advance(0)
  for (let i = 0; i < 12; i++) app.advance(70)
  assert(app.centers.some(point => point.x === 100))
  assert(app.centers.some(point => point.x === 700))
})

for (const finish of ['pointercancel', 'deactivate']) {
  test(`${finish} still cancels a gesture after capture is lost`, () => {
    const app = setup()
    app.send('pointerdown', 100, 300)
    app.send('lostpointercapture', 100, 300)
    app.send('pointermove', 700, 300)
    if (finish === 'deactivate') app.fireworks.setActive(false)
    else app.send('pointercancel', 700, 300, { blocked: true })
    app.send('pointerup', 700, 300)
    app.advance(1000)
    assert.equal(app.centers.length, 0)
  })
}
