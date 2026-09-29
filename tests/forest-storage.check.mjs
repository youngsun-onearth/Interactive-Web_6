// Legacy-data and lightweight-position-save regression check via file://.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'
const output = await mkdtemp(path.join(tmpdir(), 'forest-storage-check-'))
await build({ configFile: false, base: './', logLevel: 'error', plugins: [{
  name: 'inspect-stores', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/forest-resident-storage.ts')) return code + '\nObject.assign(window, { __storeClassic: createResidentStore });'
    if (id.endsWith('/edition-forest-resident-storage.ts')) return code + '\nObject.assign(window, { __storeEdition: createResidentStore });'
  },
}], build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const page = await browser.newPage()
try {
  await page.goto(`${pathToFileURL(path.join(output, 'index.html')).href}#animal-forest`)
  await page.waitForFunction(() => !!window.__storeClassic)
  await page.locator('.example-button[data-example="animal-forest-edition"]').click()
  await page.waitForFunction(() => !!window.__storeEdition)
  const results = await page.evaluate(async () => {
    let db
    const transaction = (mode, action) => new Promise((resolve, reject) => {
      const tx = db.transaction('residents', mode); let result
      const request = action(tx.objectStore('residents')); if (request) request.onsuccess = () => { result = request.result }
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error)
    })
    const results = []
    for (const [world, create] of [['test-13', window.__storeClassic], ['test-14', window.__storeClassic], ['test-15', window.__storeEdition]]) {
      db = await new Promise((resolve, reject) => { const r = indexedDB.open(world === 'test-15' ? 'interactive-web-edition-forest-residents' : 'interactive-web-forest-residents', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      const store = create(world), concurrent = create(world)
      const model = { object: { object: { uuid: 'saved-model', type: 'Group' }, geometries: [{ data: { attributes: { position: { array: Array.from({ length: 30000 }, (_, i) => i / 10000) } } } }] }, limbs: [], head: null, height: 2, label: '기존 주민', fingerprint: 731, mappedParts: ['face'] }
      const state = { id: 'legacy', name: '기존 주민', direction: [0, 0, 1], heading: [1, 0, 0] }
      await transaction('readwrite', s => s.put({ ...state, key: `${world}:legacy`, world, model, updatedAt: 1 }))
      const old = (await store.list())[0]
      if (JSON.stringify(old.model) !== JSON.stringify(model)) throw new Error('Legacy model changed on load')
      await store.positions([{ ...state, direction: [1, 0, 0] }]) // first legacy sidecar
      const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get
      let modelWrites = 0, modelReads = 0
      IDBObjectStore.prototype.put = function (value, ...args) { if (value?.model && value.world === world) modelWrites++; return put.call(this, value, ...args) }
      IDBObjectStore.prototype.get = function (key) { if (key === `${world}:legacy`) modelReads++; return get.call(this, key) }
      try { for (let i = 0; i < 12; i++) await store.positions([{ ...state, direction: [0, i / 12, 1] }]) }
      finally { IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.get = get }
      const restored = (await concurrent.list())[0], base = await transaction('readonly', s => s.get(`${world}:legacy`))
      if (JSON.stringify(base.model) !== JSON.stringify(model) || base.updatedAt !== 1) throw new Error('Position saves rewrote original model')
      if (restored.direction[1] !== 11 / 12 || restored.name !== state.name) throw new Error('Latest position/name did not restore')
      await store.remove(state.id)
      await concurrent.positions([{ ...state, direction: [1, 1, 1] }]); await concurrent.add(state, model)
      if ((await store.list()).length) throw new Error('Deleted resident resurrected')
      if (await transaction('readonly', s => s.get(`@positions:${world}:legacy`))) throw new Error('Deleted resident left position data')
      const fresh = { ...state, id: 'new' }; await store.add(fresh, model)
      await store.positions([{ ...fresh, direction: [0, -1, 0] }])
      const saved = (await store.list())[0]
      if (saved.direction[1] !== -1 || JSON.stringify(saved.model) !== JSON.stringify(model)) throw new Error('New resident save failed')
      results.push({ world, modelWrites, modelReads })
      db.close()
    }
    return results
  })
  for (const result of results) { assert.equal(result.modelWrites, 0); assert.equal(result.modelReads, 0) }
  console.log('PASS: legacy/new residents, position restore, deletion, cross-client tombstones.', results)
} finally { await browser.close() }
