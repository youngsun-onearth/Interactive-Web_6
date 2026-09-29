// Build to a temporary folder and use file://; never launch a web server.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'space-visitors-check-'))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'visitor-inspection', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/forest-edition/animal-edition.ts')) return code.replace('return {\n    start()', 'Object.assign(window, { __check: { THREE, world, scene, camera, renderer, controls, residents, wildlife, freeze: () => cancelAnimationFrame(animation) } });\n  return {\n    start()')
    if (id.endsWith('/forest-edition/edition-forest-residents-extended.ts')) return code.replace('return { ready: persistence.ready,', 'return { inspectWalkers: walkers, inspectSink: sinkhole, meetingCenter, ready: persistence.ready,')
    if (id.endsWith('/forest-edition/space-visitors.ts')) return code.replace('return { update, updateLabels, visitors, remove }', 'Object.assign(window, { __visitors: { visitors, injured, get flight() { return flight }, immunity } });\n  return { update, updateLabels, visitors, remove }')
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#animal-forest-edition`)
  await page.waitForFunction(() => !!window.__visitors)
  await page.evaluate(async () => {
    const f = window.__check; await f.residents.ready; f.freeze()
    f.now = performance.now(); Object.defineProperty(performance, 'now', { value: () => f.now })
    f.step = seconds => { for (let i = 0; i < seconds * 20; i++) { f.now += 50; f.wildlife.update(f.now); f.residents.update(f.now) } }
    f.render = () => { f.scene.updateMatrixWorld(true); f.renderer.render(f.scene, f.camera) }
    const photo = document.createElement('canvas'); photo.width = photo.height = 64
    const ctx = photo.getContext('2d'); ctx.fillStyle = '#bc926c'; ctx.fillRect(0, 0, 64, 64)
    const mask = { width: 64, height: 64, values: new Uint8Array(4096).fill(255) }
    const analysis = { reference: { ...mask, values: Uint8Array.from({ length: 4096 }, (_, i) => Math.hypot((i % 64 - 32) / 23, (Math.floor(i / 64) - 32) / 29) < 1 ? 255 : 0) }, person: mask, pose: [], referencePose: [], categories: [{ name: 'tabby cat', score: .99, index: 281 }] }
    await f.residents.create(photo, analysis, '우주 주민')
    document.querySelector('.edition-forest-preview-actions [data-action=land]').click(); f.step(3)
    for (let i = 0; i < 1200 && !window.__visitors.flight; i++) f.step(.05)
    f.step(2); f.render()
  })
  assert.equal(await page.locator('.space-edition').getAttribute('data-visitor-flight'), 'approaching')
  const firstPosition = await page.evaluate(() => window.__visitors.flight.ship.position.toArray())
  await page.screenshot({ path: path.join(output, 'ship-approaching.png') })
  await page.evaluate(() => { window.__check.step(3.5); window.__check.render() })
  assert.equal(await page.locator('.space-edition').getAttribute('data-outsiders'), '1')
  assert.equal(await page.locator('.space-edition').getAttribute('data-visitor-flight'), 'landing')
  assert(await page.evaluate(p => window.__visitors.flight.ship.position.distanceTo(new window.__check.THREE.Vector3(...p)) > 3, firstPosition))
  await page.screenshot({ path: path.join(output, 'astronaut-landing.png') })
  await page.evaluate(() => {
    const f = window.__check; f.step(7)
    const v = window.__visitors.visitors[0], rotation = f.world.getWorldQuaternion(new f.THREE.Quaternion())
    f.cameraBackup = { position: f.camera.position.clone(), up: f.camera.up.clone(), target: f.controls.target.clone() }
    const up = v.direction.clone().applyQuaternion(rotation), front = v.heading.clone().applyQuaternion(rotation)
    const target = v.anchor.getWorldPosition(new f.THREE.Vector3()).addScaledVector(up, .43)
    f.camera.position.copy(target).addScaledVector(front, 2.6).addScaledVector(up, .8); f.camera.up.copy(up); f.camera.lookAt(target); f.render()
  })
  await page.screenshot({ path: path.join(output, 'astronaut-detail.png') })
  await page.evaluate(() => {
    const f = window.__check
    f.camera.position.copy(f.cameraBackup.position); f.camera.up.copy(f.cameraBackup.up); f.camera.lookAt(f.cameraBackup.target)
    // Put the visitor within reach of a real resident; the normal chase/attack
    // update must set the injury, rather than mutating the target's state here.
    const v = window.__visitors.visitors[0], target = f.residents.inspectWalkers[0]
    v.direction.copy(target.direction); v.cooldown = 0; f.step(.1)
  })
  assert.equal(await page.locator('.space-edition').getAttribute('data-visitor-flight'), 'idle')
  assert(await page.evaluate(() => window.__check.residents.inspectWalkers[0].anchor.userData.incapacitated))
  await page.evaluate(() => {
    const f = window.__check, v = window.__visitors.visitors[0]
    const target = f.wildlife.animals.find(a => a.species === 'siamese'); window.__animal = target
    v.direction.copy(target.direction); v.cooldown = 0; f.step(.1)
    const fish = f.wildlife.animals.find(a => a.species === 'goldfish')
    v.direction.copy(fish.direction); v.cooldown = 0; f.step(.1)
    window.__resting = [target, fish, f.residents.inspectWalkers[0]].map(t => ({ t, direction: t.direction.clone() }))
    // Observe far beyond an animation/cooldown; nobody revives on a timer.
    f.step(18); f.render()
  })
  assert(await page.evaluate(() => window.__resting.every(({ t, direction }) => t.anchor.userData.incapacitated && t.direction.distanceTo(direction) < 1e-8)))
  assert.equal(await page.locator('.space-heal').count(), await page.evaluate(() => window.__visitors.injured.size))
  await page.screenshot({ path: path.join(output, 'waiting-for-treatment.png') })
  assert.equal(await page.locator('.space-visitors button').count(), 0)
  async function grabVisitor() {
    const point = await page.evaluate(() => {
      const f = window.__check, v = window.__visitors.visitors[0]
      v.direction.copy(f.residents.meetingCenter); v.cooldown = 1000; f.step(.05)
      const normal = v.direction.clone().applyQuaternion(f.world.getWorldQuaternion(new f.THREE.Quaternion()))
      f.camera.position.copy(normal).multiplyScalar(17); f.camera.up.set(0, 1, 0); f.controls.target.set(0, 0, 0); f.camera.lookAt(f.controls.target); f.residents.update(f.now); f.render()
      const point = new f.THREE.Box3().setFromObject(v.anchor).getCenter(new f.THREE.Vector3()).project(f.camera)
      return { x: (point.x + 1) * 720, y: (1 - point.y) * 500 }
    })
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(480)
    if (await page.locator('.space-edition').getAttribute('data-resident-interaction') !== 'held') {
      await page.screenshot({ path: path.join(output, 'grab-failed.png') })
      console.log('Grab diagnostics', await page.evaluate(p => ({ element: document.elementFromPoint(p.x, p.y)?.outerHTML, state: { ...document.querySelector('.space-edition').dataset } }), point))
    }
    assert.equal(await page.locator('.space-edition').getAttribute('data-resident-interaction'), 'held')
    await page.evaluate(() => { window.__check.step(.8); window.__check.render() })
    assert(await page.evaluate(() => window.__visitors.visitors[0].controlled))
  }
  // Canceling a grab resumes normal behavior without deleting the astronaut.
  await grabVisitor(); await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__visitors.visitors[0].controlled), false)
  await grabVisitor()
  assert.equal(await page.locator('.space-edition').getAttribute('data-sinkhole'), 'open')
  const hole = await page.evaluate(() => {
    const f = window.__check, sink = f.residents.inspectSink
    const direction = sink.center.clone(), base = f.world.localToWorld(direction.multiplyScalar(5.45)).project(f.camera)
    return { x: (base.x + 1) * 720, y: (1 - base.y) * 500 }
  })
  await page.mouse.move(hole.x, hole.y, { steps: 8 })
  assert.equal(await page.locator('.space-edition').getAttribute('data-sinkhole'), 'targeted')
  await page.screenshot({ path: path.join(output, 'astronaut-sinkhole.png') })
  await page.mouse.up()
  assert.equal(await page.locator('.space-edition').getAttribute('data-resident-interaction'), 'banishing')
  await page.evaluate(() => window.__check.step(2))
  assert.equal(await page.locator('.space-edition').getAttribute('data-outsiders'), '0')
  assert.equal(await page.evaluate(() => window.__visitors.visitors.length), 0)
  assert(await page.evaluate(() => window.__resting.every(({ t }) => t.anchor.userData.incapacitated)))
  const patients = await page.evaluate(() => [...window.__visitors.injured.keys()])
  for (let i = 0; i < patients.length; i++) {
    const id = patients[i]
    await page.evaluate(id => {
      const f = window.__check, target = window.__visitors.injured.get(id).target
      const normal = target.direction.clone().applyQuaternion(f.world.getWorldQuaternion(new f.THREE.Quaternion()))
      f.camera.position.copy(normal).multiplyScalar(17); f.camera.up.set(0, 1, 0); f.camera.lookAt(f.controls.target); f.step(.05); f.render()
    }, id)
    const button = page.locator(`.space-heal[data-target-id="${id}"]`)
    assert(await button.isVisible())
    await button.click()
    assert.equal(await page.locator('.space-edition').getAttribute('data-injured'), String(patients.length - i - 1), 'one button only heals its own character')
    assert.equal(await page.evaluate(id => window.__visitors.immunity.get(id), id), 10)
  }
  assert.equal(await page.locator('.space-edition').getAttribute('data-injured'), '0')
  assert(await page.evaluate(() => window.__resting.every(({ t }) => !t.anchor.userData.incapacitated)))
  assert.equal(await page.locator('.space-heal').count(), 0)
  await page.evaluate(() => { window.__check.step(5); window.__check.render() })
  await page.screenshot({ path: path.join(output, 'healed.png') })
  await page.evaluate(() => {
    const f = window.__check
    for (let i = 0; i < 2400 && !window.__visitors.visitors.length; i++) f.step(.05)
  })
  assert.equal(await page.locator('.space-edition').getAttribute('data-outsiders'), '1', 'another random visit occurs after the previous visitor was banished')
  assert.equal(await page.evaluate(() => window.__visitors.visitors[0].id), 2)
  assert.deepEqual(errors, [])
  console.log('PASS: arrival, individual patient labels/healing, grab/cancel, sinkhole banishment, recurring visit.', output)
} finally { await browser.close() }
