// Exercise cached/static and animated shadows with real resident creation and reload.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'
const output = await mkdtemp(path.join(tmpdir(), 'forest-classic-check-'))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'classic-inspection', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/animal-forest.ts')) return code.replace('function animate(now: number) {', 'function animate(now: number) { if (window.__manualForest) return;')
      .replace('return {\n    start()', 'Object.assign(window, { __classic: { root, renderer, scene, camera, residents } });\n  return {\n    start()')
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
try {
  for (const example of ['animal-forest', 'animal-forest-extended']) {
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(() => { window.__manualForest = true })
    await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#${example}`)
    await page.waitForFunction(() => !!window.__classic)
    const result = await page.evaluate(async () => {
      const f = window.__classic; await f.residents.ready
      f.render = () => f.renderer.render(f.scene, f.camera)
      f.render(); f.render(); const staticCached = !f.renderer.shadowMap.autoUpdate && !f.renderer.shadowMap.needsUpdate
      f.now = performance.now(); Object.defineProperty(performance, 'now', { value: () => f.now })
      f.step = seconds => { for (let i = 0; i < seconds * 20; i++) { f.now += 50; f.residents.update(f.now) } }
      const photo = document.createElement('canvas'); photo.width = photo.height = 64
      const ctx = photo.getContext('2d'); ctx.fillStyle = '#bc926c'; ctx.fillRect(0, 0, 64, 64)
      const mask = { width: 64, height: 64, values: new Uint8Array(4096).fill(255) }
      const analysis = { reference: { ...mask, values: Uint8Array.from({ length: 4096 }, (_, i) => Math.hypot((i % 64 - 32) / 23, (Math.floor(i / 64) - 32) / 29) < 1 ? 255 : 0) }, person: mask, pose: [], referencePose: [], categories: [{ name: 'tabby cat', score: .99, index: 281 }] }
      await f.residents.create(photo, analysis, '기존 예제 주민'); f.render()
      const previewDynamic = f.renderer.shadowMap.autoUpdate
      f.root.querySelector('.forest-preview-actions [data-action=land]')?.click()
      f.step(7); f.render()
      return { staticCached, previewDynamic, walkingDynamic: f.renderer.shadowMap.autoUpdate, residents: f.root.dataset.residents, introducing: f.residents.introducing }
    })
    assert(result.staticCached && result.previewDynamic && result.walkingDynamic)
    assert.equal(result.residents, '1'); assert.equal(result.introducing, false)
    await page.waitForFunction(() => window.__classic.root.dataset.residentStorage === 'saved')
    await page.reload(); await page.waitForFunction(() => !!window.__classic)
    const restored = await page.evaluate(async () => { const f = window.__classic; await f.residents.ready; f.renderer.render(f.scene, f.camera); return { count: f.root.dataset.residents, dynamic: f.renderer.shadowMap.autoUpdate } })
    assert.equal(restored.count, '1'); assert(restored.dynamic); assert.deepEqual(errors, [])
    console.log('PASS:', example, 'preview, arrival, animated shadows and stored model reload')
    await page.close()
  }
} finally { await browser.close() }
