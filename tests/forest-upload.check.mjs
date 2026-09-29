// Run directly with node. Builds a local HTML fixture; never starts a server.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = await mkdtemp(path.join(tmpdir(), 'forest-upload-'))
const entry = path.join(root, `.forest-upload-check-${process.pid}.ts`)
let browser
try {
  await writeFile(entry, `
import { createMoveIn } from './src/forest-move-in'
const root = document.querySelector('#root') as HTMLElement
createMoveIn({ root, onCreate: async () => {}, onOpen: () => {} })
`)
  await build({ root, configFile: false, publicDir: false, logLevel: 'error', plugins: [{
    name: 'upload-check-worker', enforce: 'pre',
    resolveId(id) { if (id.endsWith('forest-resident.worker?worker')) return '\0upload-check-worker' },
    load(id) { if (id === '\0upload-check-worker') return 'export default class { postMessage() { queueMicrotask(() => this.onmessage?.({data:{type:"ready"}})) } terminate() {} }' },
  }], build: { outDir: out, emptyOutDir: true, lib: { entry, name: 'UploadCheck', formats: ['iife'], fileName: () => 'fixture.js', cssFileName: 'fixture' } } })
  await writeFile(path.join(out, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><main id="root" data-example-panel="animal-forest-extended"></main><script src="fixture.js"></script>')
  browser = await chromium.launch({ args: ['--allow-file-access-from-files'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  // File selection must also work before camera permission is granted.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('Test camera unavailable', 'NotAllowedError') } } })
  })
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href)
  const open = page.locator('.forest-move-in'); const drop = page.locator('.forest-studio__drop')
  const name = page.locator('.forest-studio__name-input'); const preview = page.locator('.forest-studio__drop img')
  const close = page.locator('.forest-studio__close')
  await open.click(); await name.fill('보리'); await name.press('Tab')
  assert.equal(await name.inputValue(), '보리', 'leaving the name field must not clear it')
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 })
  await drop.click(); const chooser = await chooserPromise
  assert.equal(await chooser.element().getAttribute('type'), 'file')
  await chooser.setFiles(path.join(root, 'public/lemonade/lemon.png'))
  await preview.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('.forest-studio__drop img').naturalWidth > 0)
  assert.equal(await name.inputValue(), '보리')
  assert.equal(await page.locator('.forest-studio__file-name').textContent(), 'lemon.png')
  assert.equal(await page.locator('.forest-studio__file').inputValue(), '', 'file input resets so the same image can be selected again')
  const againPromise = page.waitForEvent('filechooser', { timeout: 5000 }); await drop.click()
  await (await againPromise).setFiles(path.join(root, 'public/lemonade/lemon.png'))
  assert.equal(await name.inputValue(), '보리')
  await close.click(); await open.click(); await name.fill('새싹')
  // Exercise the independent drop path using a real image generated in canvas.
  await drop.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#69a359'; ctx.fillRect(0, 0, 8, 8)
    const raw = atob(canvas.toDataURL('image/png').split(',')[1]); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await page.waitForFunction(() => document.querySelector('.forest-studio__file-name').textContent === 'dropped.png')
  assert.equal(await name.inputValue(), '새싹'); assert.equal(await preview.isVisible(), true)
  await close.click(); assert.deepEqual(errors, [])
  console.log('PASS: actual picker opens, preview loads, name survives, same file can be reselected, drag/drop works after reopening.')
} finally {
  await browser?.close()
  await unlink(entry).catch(() => {})
  await rm(out, { recursive: true, force: true })
}
