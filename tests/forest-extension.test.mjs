import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { forestOrientation, forestTangent, meetingSlots, createForestNavigation, warpSurfaceUV } from '../src/forest-extension-math.ts'

test('residents remain upright and face tangent to the sphere, including at the poles', () => {
  for (const normal of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 2, 3).normalize()]) {
    const heading = forestTangent(normal); const rotation = forestOrientation(normal, heading)
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).distanceTo(normal) < 1e-6)
    assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).distanceTo(heading) < 1e-6)
  }
})

test('meeting seats have physical separation and avoid occupied ground', () => {
  const center = new THREE.Vector3(0, 0, 1)
  const free = p => p.x > -.32 && p.distanceTo(center) < .7
  const seats = meetingSlots(center, 36, free, .145)
  assert.equal(seats.length, 36)
  for (let i = 0; i < seats.length; i++) {
    assert.ok(free(seats[i])); assert.ok(Math.abs(seats[i].length() - 1) < 1e-6)
    for (let j = i + 1; j < seats.length; j++) assert.ok(seats[i].distanceTo(seats[j]) >= .145 * .97)
  }
})

test('spherical paths reach the other side of the globe without walking through trees', () => {
  const trees = Array.from({ length: 12 }, (_, i) => new THREE.Vector3(Math.sin(i * .22), .12, Math.cos(i * .22)).normalize())
  const navigation = createForestNavigation(p => ({ waterDistance: Math.abs(p.y) < .055 ? -.03 : .2 }), trees)
  const end = new THREE.Vector3(.1, .2, 1).normalize()
  for (const start of [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)]) {
    const path = navigation.route(start, end)
    assert.ok(path.length > 10); assert.ok(path.at(-1).distanceTo(end) < 1e-6)
    for (const p of path.slice(0, -1)) assert.ok(trees.every(t => t.distanceToSquared(p) >= .0049))
    for (let i = 1; i < path.length; i++) assert.ok(path[i].distanceTo(path[i - 1]) < .2)
  }
})

test('meeting paths can be replanned around residents who already occupy their seats', () => {
  const navigation = createForestNavigation(() => ({ waterDistance: .4 }), [])
  const occupied = [{ position: new THREE.Vector3(0, 0, 1), radius: .16 }]
  const start = new THREE.Vector3(-.4, 0, 1).normalize(); const end = new THREE.Vector3(.4, 0, 1).normalize()
  const path = navigation.route(start, end, occupied)
  assert.ok(path.length > 2)
  for (let i = 0; i < path.length; i++) {
    assert.ok(path[i].distanceTo(occupied[0].position) >= .16)
    if (i) assert.ok(path[i].clone().add(path[i - 1]).normalize().distanceTo(occupied[0].position) >= .16)
  }
})

test('a texture stroke smoothly moves neighboring UVs while preserving geometry and the back surface', () => {
  const positions = new Float32Array([0, 0, 0, .2, 0, 0, .5, 0, 0, .99, 0, 0, 1.1, 0, 0, 0, 0, -.1])
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1])
  const original = positions.slice(); const uv = new Float32Array(12).fill(.5)
  warpSurfaceUV(positions, normals, uv, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector2(.1, 0), 1)
  assert.deepEqual(positions, original)
  assert.ok(uv[0] < uv[2] && uv[2] < uv[4] && uv[4] < uv[6])
  assert.ok(Math.abs(uv[6] - .5) < .00001)
  assert.equal(uv[8], .5); assert.equal(uv[10], .5)
  for (let i = 0; i < 200; i++) warpSurfaceUV(positions, normals, uv, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector2(.1, -.1), 1)
  assert.ok(uv.every(v => Number.isFinite(v) && v >= .0049 && v <= .9951))
})
