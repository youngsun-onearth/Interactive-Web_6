import test from 'node:test'
import assert from 'node:assert/strict'
import { WaterSurface } from '../src/water-surface.ts'

test('a touch propagates outside its source and dissipates without numerical instability', () => {
  const water = new WaterSurface(1, 96)
  water.disturb(.5, .5)
  const probe = 48 * water.width + 60
  assert.equal(water.current[probe], 0)
  for (let i = 0; i < 40; i++) water.step()
  assert.ok(Math.abs(water.current[probe]) > .0001)
  const energy = () => water.current.reduce((sum, value) => sum + value * value, 0)
  const moving = energy()
  for (let i = 0; i < 1000; i++) water.step()
  assert.ok(water.current.every(Number.isFinite))
  assert.ok(energy() < moving * .02)
})

test('fast finger motion leaves a continuous wake between detections', () => {
  const water = new WaterSurface(1, 96)
  water.disturb(.7, .5, .3, .5)
  for (let x = 31; x <= 64; x++) assert.ok(water.current[48 * water.width + x] < 0)
})

test('a wide palm impact affects a larger area than a fingertip impact', () => {
  const fingertip = new WaterSurface(1, 96)
  const fist = new WaterSurface(1, 96)
  fingertip.disturb(.5, .5, .5, .5, -.13, 3)
  fist.disturb(.5, .5, .5, .5, -.24, 10)
  const probe = 48 * fist.width + 56
  assert.equal(fingertip.current[probe], 0)
  assert.ok(fist.current[probe] < -.001)
})

test('temporary extra damping settles a wide palm wave faster', () => {
  const normal = new WaterSurface(1, 96)
  const settled = new WaterSurface(1, 96)
  normal.disturb(.5, .5, .5, .5, -.12, 9)
  settled.disturb(.5, .5, .5, .5, -.12, 9)
  for (let frame = 0; frame < 60; frame++) { normal.step(); settled.step(.985) }
  const energy = (water) => water.current.reduce((sum, value) => sum + value * value, 0)
  assert.ok(energy(settled) < energy(normal) * .55)
})

test('ten overlapping touches remain bounded and a flat surface has no refraction', () => {
  const water = new WaterSurface(.5)
  assert.ok(water.normals.every((value, i) => value === (i % 4 === 3 ? 255 : 128)))
  for (let frame = 0; frame < 300; frame++) {
    for (let finger = 0; finger < 10; finger++) water.disturb(.5, .5)
    water.step(); water.step()
  }
  assert.ok(water.current.every(value => Number.isFinite(value) && Math.abs(value) < 3))
})
