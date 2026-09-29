import test from 'node:test'
import assert from 'node:assert/strict'
import { entersCup, coverPoint, isClosedFist } from '../src/lemonade-physics.ts'

test('fast falling drops enter only through the cup opening', () => {
  const rim = { x: 200, y: 300 }
  assert.equal(entersCup({ x: 200, y: 100 }, { x: 210, y: 500 }, rim, rim, 50), true)
  assert.equal(entersCup({ x: 280, y: 100 }, { x: 280, y: 500 }, rim, rim, 50), false)
  assert.equal(entersCup({ x: 200, y: 320 }, { x: 200, y: 350 }, rim, rim, 50), false)
  assert.equal(entersCup({ x: 200, y: 350 }, { x: 200, y: 250 }, rim, rim, 50), false)
})
test('cup collision interpolates both the moving cup and the drop', () => {
  assert.equal(entersCup({ x: 150, y: 250 }, { x: 150, y: 350 }, { x: 100, y: 300 }, { x: 200, y: 300 }, 20), true)
  assert.equal(entersCup({ x: 200, y: 250 }, { x: 200, y: 350 }, { x: 100, y: 300 }, { x: 200, y: 300 }, 20), false)
})
test('hand positions match a mirrored cover camera across aspect ratios', () => {
  assert.deepEqual(coverPoint({ x: .5, y: .5 }, 1280, 720, 390, 844), { x: 195, y: 422 })
  assert.equal(coverPoint({ x: 0, y: .5 }, 1280, 720, 390, 844).x < 0, true)
  assert.deepEqual(coverPoint({ x: 0, y: 0 }, 1280, 720, 1280, 720), { x: 0, y: 0 })
})
function fingers(closed) {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  for (const base of [5, 9, 13, 17]) {
    p[base] = { x: base / 100, y: 0, z: 0 }
    p[base + 1] = { x: base / 100, y: -1, z: 0 }
    p[base + 3] = { x: base / 100, y: closed ? -.1 : -2, z: closed ? .2 : 0 }
  }
  return p
}
test('fist recognition distinguishes open and curled fingers, including rotation', () => {
  assert.equal(isClosedFist(fingers(false)), false)
  assert.equal(isClosedFist(fingers(true)), true)
  assert.equal(isClosedFist(fingers(true).map(p => ({ x: -p.y, y: p.x, z: p.z }))), true)
  assert.equal(isClosedFist([]), false)
})
