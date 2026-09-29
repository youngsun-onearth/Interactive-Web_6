// Static file check. No development or preview server.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'example-menu-check-'))
await build({ configFile: false, base: './', logLevel: 'error', build: { outDir: output, emptyOutDir: true } })
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href)
  const toggle = page.locator('.example-menu-toggle'), menu = page.locator('.example-controls')
  const examples = await page.locator('.example-button').evaluateAll(nodes => nodes.map(n => n.dataset.example))
  for (const example of examples) {
    await page.locator(`.example-button[data-example="${example}"]`).click()
    await page.waitForFunction(example => document.querySelector('.night-sky').dataset.example === example, example)
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert(await menu.evaluate(el => el.inert && el.getBoundingClientRect().bottom <= 0))
    assert(await toggle.isVisible())
    // The tab remains keyboard-operable even though the list is inert.
    await toggle.focus(); await page.keyboard.press('Enter')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    assert(await menu.isVisible())
    const bounds = await toggle.boundingBox()
    assert(bounds.y >= 0 && bounds.y + bounds.height < 1000)
  }
  await toggle.click()
  await page.reload()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'collapsed state survives reload')
  await toggle.click()
  assert(await menu.isVisible())
  assert.deepEqual(errors, [])
  console.log(`PASS: hide/show and keyboard access in ${examples.length} examples; state restored on reload.`)
} finally { await browser.close() }
