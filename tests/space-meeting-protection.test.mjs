import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createSpaceVisitors } from '../src/forest-edition/space-visitors.ts'

test('visitors keep arriving during meetings without attacks; attacks resume after return', () => {
  class Element {
    dataset = {}; children = []; style = {}
    append(child) { this.children.push(child) }
    querySelector() { return new Element() }
    setAttribute() {}
    remove() {}
  }
  const previousDocument = globalThis.document
  globalThis.document = { createElement: () => new Element() }
  try {
    const root = new Element(), world = new THREE.Group(), camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, 20)
    const anchor = new THREE.Group(), body = new THREE.Group()
    anchor.add(body); world.add(anchor)
    const target = { id: 'resident', name: '주민', anchor, direction: new THREE.Vector3(0, 0, 1), model: { group: body } }
    anchor.position.copy(target.direction).multiplyScalar(5.4)
    let meetingPhase = 'gathering'
    const visitors = createSpaceVisitors({ root, world, camera, canvas: new Element(),
      terrain: () => ({ radius: 5.4, waterDistance: 1 }), trees: [],
      getTargets: () => [target], allowed: () => true, canAttack: () => meetingPhase === 'idle',
    })
    const advance = seconds => { for (let i = 0; i < seconds * 20; i++) visitors.update(.05) }
    advance(65)
    assert(visitors.visitors.length > 0, 'a visitor lands while residents gather')
    assert.equal(root.dataset.visitorFlight, 'idle', 'ship departs normally')
    assert.equal(root.dataset.injured, '0')
    meetingPhase = 'gathered'; advance(130)
    assert(visitors.visitors.length >= 2, 'repeat visits still run during a meeting')
    assert.equal(root.dataset.injured, '0')
    meetingPhase = 'returning'; advance(20)
    assert.equal(root.dataset.injured, '0', 'returning participants remain protected')
    assert(!anchor.userData.incapacitated)
    meetingPhase = 'idle'; advance(1)
    assert.equal(root.dataset.injured, '1', 'ordinary attacks resume after the meeting')
    assert.equal(anchor.userData.incapacitated, true)
    const labels = root.children.find(e => e.className === 'space-treatment-labels')
    labels.children[0].onclick({ stopPropagation() {} })
    assert.equal(anchor.userData.incapacitated, false, 'individual treatment still works')
    assert.equal(root.dataset.injured, '0')
  } finally { globalThis.document = previousDocument }
})
