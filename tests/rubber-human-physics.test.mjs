import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/rubber-human-physics.ts', import.meta.url), 'utf8')
const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
const physics = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

test('rubber falloff is smooth, local, and strongest at the pinch', () => {
  assert.equal(physics.rubberWeight(0, 100), 1)
  assert.equal(physics.rubberWeight(100, 100), 0)
  assert.equal(physics.rubberWeight(150, 100), 0)
  assert.ok(physics.rubberWeight(25, 100) > physics.rubberWeight(50, 100))
  assert.ok(physics.rubberWeight(50, 100) > physics.rubberWeight(75, 100))
})

test('released elastic point overshoots and settles back at rest', () => {
  const state = { x: 120, y: -30, vx: 0, vy: 0 }
  let crossedRest = false

  for (let index = 0; index < 360; index += 1) {
    physics.stepElastic(state, { x: 0, y: 0 }, 1 / 60, 88, 7.5)
    if (state.x < 0) crossedRest = true
  }

  assert.equal(crossedRest, true)
  assert.ok(Math.hypot(state.x, state.y) < 0.02)
  assert.ok(Math.hypot(state.vx, state.vy) < 0.2)
})

test('face hit testing follows the polygon rather than its rectangle', () => {
  const diamond = [{ x: 0, y: -2 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 }]
  assert.equal(physics.pointInPolygon({ x: 0, y: 0 }, diamond), true)
  assert.equal(physics.pointInPolygon({ x: 1.8, y: 1.8 }, diamond), false)
})
