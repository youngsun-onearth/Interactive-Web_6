import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import * as THREE from 'three'
import { indexForestPoints, accelerateForestGround } from '../src/forest-performance.ts'
import { createForestNavigation } from '../src/forest-navigation.ts'

test('indexed terrain distances equal the full scan, without sampling or quantization', () => {
  const points = Array.from({ length: 700 }, (_, i) => new THREE.Vector3(Math.sin(i * .11), Math.cos(i * .047), Math.sin(i * .083)).normalize())
  const index = indexForestPoints(points)
  for (let i = 0; i < 2000; i++) {
    const p = new THREE.Vector3(Math.sin(i * 2.37), Math.cos(i * .713), Math.sin(i * 1.91)).normalize()
    assert.equal(index.distance(p), Math.sqrt(Math.min(...points.map(q => p.distanceToSquared(q)))))
  }
})

test('accelerated picking preserves hit positions, faces, normals and UVs under globe transforms', () => {
  const geometry = new THREE.SphereGeometry(5, 96, 60), positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(positions, i); p.multiplyScalar(1 + Math.sin(p.x * 2 + p.y) * .06); positions.setXYZ(i, p.x, p.y, p.z) }
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
  const original = new THREE.Mesh(geometry, material), optimized = new THREE.Mesh(geometry, material)
  for (const mesh of [original, optimized]) { mesh.rotation.set(.24, .6, -.3); mesh.position.set(.1, -.2, .3); mesh.scale.set(1.1, .9, 1); mesh.updateMatrixWorld() }
  accelerateForestGround(optimized)
  const raycaster = new THREE.Raycaster()
  for (let i = 0; i < 240; i++) {
    const direction = new THREE.Vector3(Math.sin(i * .32), Math.cos(i * .79), Math.sin(i * .67)).normalize()
    raycaster.set(direction.clone().multiplyScalar(14), direction.negate())
    const a = raycaster.intersectObject(original), b = raycaster.intersectObject(optimized)
    assert.equal(a.length, b.length)
    for (let j = 0; j < a.length; j++) {
      assert(a[j].point.distanceTo(b[j].point) < 1e-9)
      assert(a[j].uv.distanceTo(b[j].uv) < 1e-9)
      assert(a[j].normal.distanceTo(b[j].normal) < 1e-9)
      assert.equal(a[j].faceIndex, b[j].faceIndex); assert.equal(b[j].object, optimized)
    }
  }
  assert.equal(original.geometry, optimized.geometry)
  geometry.dispose(); material.dispose()
})

test('cached heap navigation retains the exact pre-optimization paths and tie order', () => {
  const trees = Array.from({ length: 18 }, (_, i) => new THREE.Vector3(Math.sin(i * .22), .12, Math.cos(i * .22)).normalize())
  const nav = createForestNavigation(p => ({ waterDistance: Math.abs(p.y) < .055 ? -.03 : .2 }), trees)
  const paths = []
  for (let i = 0; i < 18; i++) {
    const start = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * .71), Math.cos(i * .39)).normalize()
    const end = new THREE.Vector3(Math.cos(i * 1.4), Math.sin(i * .53), Math.sin(i * .92)).normalize()
    const occupied = i % 2 ? [{ position: new THREE.Vector3(0, 0, 1), radius: .16 }] : []
    paths.push(nav.route(start, end, occupied).map(p => p.toArray()))
  }
  // Captured from the original scan/Set implementation on these same inputs.
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(paths)).digest('hex'), '7fb87b8e3880034b646ba8d8c826fbadb07b3494f2be0ccd6bef1a4f03994d0a')
})
