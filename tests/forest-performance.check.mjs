// Deterministic static-file performance/visual capture. No HTTP server.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const label = process.argv[2] || 'current'
const output = await mkdtemp(path.join(tmpdir(), `forest-performance-${label}-`))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'forest-performance', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/animal-forest.ts') || id.endsWith('/forest-edition/animal-edition.ts')) {
      const edition = id.endsWith('/animal-edition.ts')
      return code.replace('function animate(now: number) {', 'function animate(now: number) { if (window.__manualForest) return;')
        .replace('return {\n    start()', `Object.assign(window, { __forest: { THREE, root, scene, world, camera, renderer, controls, ground, residents, terrain, trees: treePlaces, ${edition ? 'wildlife, space,' : ''} update(now) { controls.update(); ${edition ? 'wildlife.update(now);' : ''} residents.update(now); ${edition ? 'space.update(now, false, false);' : ''} } } });\n  return {\n    start()`)
    }
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const results = []
try {
  for (const example of ['animal-forest', 'animal-forest-extended', 'animal-forest-edition']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await page.addInitScript(() => { window.__manualForest = true; Math.random = (() => { let n = 9527; return () => { n = Math.imul(n, 1664525) + 1013904223 | 0; return (n >>> 0) / 4294967296 } })() })
    await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#${example}`)
    await page.waitForFunction(() => !!window.__forest)
    await page.evaluate(async () => { const f = window.__forest; await f.residents.ready; f.update(0); f.renderer.render(f.scene, f.camera); f.renderer.getContext().finish() })
    await page.screenshot({ path: path.join(output, `${example}.png`) })
    const result = await page.evaluate(() => {
      const f = window.__forest, gl = f.renderer.getContext(), samples = { update: [], render: [], picking: [], terrain: [] }
      const average = values => values.reduce((a, b) => a + b, 0) / values.length
      const ray = new f.THREE.Raycaster(), ndc = new f.THREE.Vector2()
      for (let i = 0; i < 80; i++) {
        let at = performance.now(); f.update(i * 16.6667); if (i >= 20) samples.update.push(performance.now() - at)
        at = performance.now(); f.renderer.render(f.scene, f.camera); gl.finish(); if (i >= 20) samples.render.push(performance.now() - at)
        at = performance.now(); for (let j = 0; j < 10; j++) { ndc.set((j - 5) * .055, .1); ray.setFromCamera(ndc, f.camera); ray.intersectObject(f.ground) } if (i >= 20) samples.picking.push((performance.now() - at) / 10)
      }
      const p = new f.THREE.Vector3()
      for (let run = 0; run < 12; run++) { const at = performance.now(); for (let i = 0; i < 10000; i++) { p.set(Math.sin(i), Math.cos(i * 1.73), Math.sin(i * 2.37)).normalize(); f.terrain(p) } if (run > 1) samples.terrain.push(performance.now() - at) }
      return { timingsMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, Number(average(values).toFixed(3))])), drawCalls: f.renderer.info.render.calls, triangles: f.renderer.info.render.triangles, geometries: f.renderer.info.memory.geometries }
    })
    results.push({ example, ...result }); console.log(example, result)
    await page.close()
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log('Artifacts:', output)
} finally { await browser.close() }
