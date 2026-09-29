// Static-file integration check; no development or preview server is started.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'space-meeting-check-'))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'meeting-inspection', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/forest-edition/space-visitors.ts')) return code.replace('if (!allowed()) return', 'if (!allowed() || window.__skipSpaceVisitors) return')
    if (id.endsWith('/forest-edition/animal-edition.ts')) return code.replace('return {\n    start()', 'Object.assign(window, { __meeting: { THREE, world, scene, camera, renderer, controls, residents, wildlife, space, freeze: () => cancelAnimationFrame(animation) } });\n  return {\n    start()')
    if (id.endsWith('/forest-edition/edition-forest-residents-extended.ts')) return code.replace('return { ready: persistence.ready,', 'return { inspectHomes: meetingHomes, inspectGuests: meetingGuests, inspectWalkers: walkers, ready: persistence.ready,')
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await page.addInitScript(() => { window.__skipSpaceVisitors = true })
  await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#animal-forest-edition`)
  await page.waitForFunction(() => !!window.__meeting)
  await page.screenshot({ path: path.join(output, 'reference-palette.png') })
  await page.evaluate(async () => {
    const f = window.__meeting; await f.residents.ready; f.freeze()
    f.now = performance.now(); Object.defineProperty(performance, 'now', { value: () => f.now })
    f.step = seconds => { for (let i = 0; i < seconds * 20; i++) { f.now += 50; f.wildlife.update(f.now); f.residents.update(f.now) } }
    const photo = document.createElement('canvas'); photo.width = photo.height = 64
    const ctx = photo.getContext('2d'); ctx.fillStyle = '#bc926c'; ctx.fillRect(0, 0, 64, 64)
    const mask = { width: 64, height: 64, values: new Uint8Array(4096).fill(255) }
    const analysis = { reference: { ...mask, values: Uint8Array.from({ length: 4096 }, (_, i) => Math.hypot((i % 64 - 32) / 23, (Math.floor(i / 64) - 32) / 29) < 1 ? 255 : 0) }, person: mask, pose: [], referencePose: [], categories: [{ name: 'tabby cat', score: .99, index: 281 }] }
    for (let i = 0; i < 2; i++) {
      await f.residents.create(photo, analysis, `회의 주민 ${i + 1}`)
      document.querySelector('.edition-forest-preview-actions [data-action=land]').click(); f.step(3)
    }
  })
  const button = page.locator('.edition-forest-meeting')
  assert.match(await button.textContent(), /주민 회의/)
  assert.equal(await page.evaluate(() => !!window.__meeting.world.getObjectByName('행성의 푸른 대기')), false)
  async function begin() {
    await button.click()
    await page.waitForFunction(() => document.querySelector('.space-edition').dataset.meetingRoutes === 'ready')
    return page.evaluate(() => {
      const { residents } = window.__meeting
      window.__meeting.saved = [...residents.inspectHomes].map(([w, h]) => ({ w, position: h.position.clone(), direction: h.direction.clone() }))
      return { count: residents.inspectHomes.size, species: [...residents.inspectGuests.values()].map(a => a.species) }
    })
  }
  const participants = await begin()
  assert.equal(participants.count, 18); assert.equal(participants.species.length, 16); assert.equal(new Set(participants.species).size, 16)
  async function advanceUntil(state) {
    for (let i = 0; i < 12; i++) {
      const result = await page.evaluate(targetState => {
        const f = window.__meeting
        for (let n = 0; n < 600 && document.querySelector('.space-edition').dataset.meeting !== targetState; n++) f.step(.05)
        return { state: document.querySelector('.space-edition').dataset.meeting, remaining: [...f.residents.inspectHomes.keys()].filter(w => !w.settled).map(w => [w.name, w.direction.distanceTo(w.meetingTarget), w.route.slice(0, 2).map(p => w.direction.distanceTo(p)), [...f.residents.inspectHomes.keys()].filter(o => o !== w && o.direction.distanceTo(w.direction) < .22).map(o => [o.name, o.direction.distanceTo(w.direction)])]) }
      }, state)
      if (result.state === state) return
      if (i === 11) assert.fail(JSON.stringify(result))
    }
  }
  await advanceUntil('gathered')
  const spacing = await page.evaluate(() => {
    const f = window.__meeting, members = [...f.residents.inspectHomes.keys()]
    f.scene.updateMatrixWorld(true); f.renderer.render(f.scene, f.camera)
    return Math.min(...members.flatMap((a, i) => members.slice(i + 1).map(b => a.anchor.position.distanceTo(b.anchor.position))))
  })
  assert(spacing > .7, `attendees overlap: ${spacing}`)
  await page.screenshot({ path: path.join(output, 'residents-meeting.png') })
  await button.click(); await advanceUntil('idle')
  async function verifyHome() {
    return page.evaluate(() => {
      const f = window.__meeting
      return { maxError: Math.max(...f.saved.map(({ w, direction }) => w.direction.distanceTo(direction))), controlled: f.wildlife.animals.filter(a => a.meetingControlled).length, bubbles: f.scene.getObjectsByProperty('name', '수중 동물의 회의 물방울').length }
    })
  }
  let restored = await verifyHome(); assert(restored.maxError < .000001); assert.equal(restored.controlled, 0); assert.equal(restored.bubbles, 0)
  // Ending the meeting mid-journey must restore the same snapshots too.
  await begin(); await page.evaluate(() => window.__meeting.step(2)); await button.click(); await advanceUntil('idle')
  restored = await verifyHome(); assert(restored.maxError < .000001); assert.equal(restored.controlled, 0)
  // Switching away must not strand any animal in a controlled state.
  await begin(); await page.locator('.example-button[data-example=heart]').click()
  restored = await verifyHome(); assert(restored.maxError < .000001); assert.equal(restored.controlled, 0)
  assert.deepEqual(errors, [])
  console.log('PASS:', { participants, spacing, restored, screenshots: output })
} finally { await browser.close() }
