// Inspect a static file build; never start a development or preview server.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'bubble-wrap-check-'))
let browser
try {
  await build({ configFile: false, base: './', logLevel: 'error', build: { outDir: output, emptyOutDir: true } })
  browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] }).catch(error => {
    if (!error.message.includes("Executable doesn't exist")) throw error
    return chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] })
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/^https?:/, route => route.abort())
  await page.addInitScript(() => {
    window.__bubbleSounds = []
    const start = AudioBufferSourceNode.prototype.start
    const stop = AudioBufferSourceNode.prototype.stop
    const records = new WeakMap()
    AudioBufferSourceNode.prototype.start = function (...args) {
      const data = this.buffer.getChannelData(0)
      let energy = 0, peak = 0
      for (const sample of data) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)) }
      const record = { duration: this.buffer.duration, rms: Math.sqrt(energy / data.length), peak, stopped: false, ended: false }
      records.set(this, record)
      window.__bubbleSounds.push(record)
      this.addEventListener('ended', () => { record.ended = true })
      return start.apply(this, args)
    }
    AudioBufferSourceNode.prototype.stop = function (...args) {
      const record = records.get(this)
      if (record) record.stopped = true
      return stop.apply(this, args)
    }
  })
  const url = pathToFileURL(path.join(output, 'index.html')).href
  await page.goto(url)
  await page.locator('.example-button[data-example="walker"]').click()
  const panel = page.locator('.bubble-wrap')
  const bubble = index => page.locator(`.bubble-wrap__bubble[data-index="${index}"]`)
  const state = index => bubble(index).getAttribute('data-state')
  const soundCount = () => page.evaluate(() => window.__bubbleSounds.length)
  const center = async index => {
    const rect = await bubble(index).boundingBox()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }
  const click = async index => { const point = await center(index); await page.mouse.click(point.x, point.y) }
  assert.equal(await panel.textContent(), '', 'the sheet has no title, instructions or counter')
  assert.equal(await page.locator('.stars').isVisible(), false)
  assert.equal(await page.locator('.walkers').count(), 0)
  assert.equal(await page.locator('.example-menu-toggle').getAttribute('aria-expanded'), 'false')
  assert.equal(await page.locator('.example-menu-toggle').evaluate(el => getComputedStyle(el).fontSize), '0px')
  assert.equal(await page.locator('.guestbook-link').isVisible(), false)
  assert.equal(await page.locator('.capture').count(), 0)
  assert(await panel.locator('button').count() >= 180, 'bubbles cover the desktop')
  assert.equal(await soundCount(), 0, 'entry is silent')
  const first = await center(51)
  await page.mouse.move(first.x, first.y)
  assert.equal(await state(51), 'ready', 'hovering does not pop')
  await page.mouse.down()
  assert.equal(await state(51), 'popped', 'a bubble pops immediately on contact')
  await page.mouse.up()
  await page.waitForTimeout(250)
  assert.equal(await soundCount(), 1, 'a tap produces one sound')
  const opacity = () => bubble(51).locator('.bubble-wrap__dome').evaluate(el => Number(getComputedStyle(el).opacity))
  assert(await opacity() < 0.1, 'the dome visibly collapses')
  await click(51)
  assert.equal(await soundCount(), 1, 'an empty pocket cannot repeatedly pop')
  for (const [i, random] of [0.1, 0.5, 0.9].entries()) {
    await page.evaluate(value => { Math.random = () => value }, random)
    await click(52 + i)
    await page.waitForTimeout(25)
  }
  const sounds = await page.evaluate(() => window.__bubbleSounds)
  assert.equal(new Set(sounds.map(sound => sound.duration.toFixed(3))).size, 3, 'three random sound variants play')
  assert(sounds.every(sound => sound.rms > 0.025 && sound.peak < 1), 'all pop waveforms are audible and unclipped')
  const screenshots = process.env.BUBBLE_WRAP_SCREENSHOT_DIR
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: path.join(screenshots, 'bubble-wrap-desktop.png') })
  }
  await page.waitForTimeout(3400)
  const growing = await opacity()
  assert(growing > 0.15 && growing < 0.95, 'the bubble gradually inflates rather than instantly resetting')
  assert.equal(await state(51), 'popped')
  await page.waitForTimeout(4400)
  assert.equal(await state(51), 'ready', 'the pocket fully recovers without user action')
  assert(await opacity() > 0.99)
  const beforeRepop = await soundCount()
  await click(51)
  await page.waitForTimeout(40)
  assert.equal(await soundCount(), beforeRepop + 1, 'a recovered bubble can pop again')

  const from = await center(81), to = await center(92)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 1 })
  await page.mouse.up()
  for (let i = 81; i <= 92; i++) assert.equal(await state(i), 'popped', 'fast dragging fills the entire path')
  for (let i = 97; i <= 108; i++) assert.equal(await state(i), 'ready', 'pockets beside the path remain inflated')
  const below = await center(100)
  await page.mouse.move(below.x, below.y)
  assert.equal(await state(100), 'ready', 'release ends the drag')
  await page.locator('.example-menu-toggle').click()
  await page.locator('.example-button[data-example="gaze"]').click()
  assert(await page.evaluate(() => window.__bubbleSounds.every(sound => sound.stopped || sound.ended)), 'leaving the example stops sound')
  assert.equal(await panel.isVisible(), false)
  await page.locator('.example-button[data-example="walker"]').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const last = document.querySelector('.bubble-wrap__bubble:last-child')?.getBoundingClientRect()
    return last && last.top < 844 && last.bottom >= 844
  })
  const bounds = await panel.boundingBox()
  assert.equal(bounds.width, 390)
  assert.equal(bounds.height, 844)
  const mobileLast = await panel.locator('button').last().boundingBox()
  assert(mobileLast.y < 844 && mobileLast.y + mobileLast.height >= 844, 'the mobile sheet reaches the bottom edge')
  const mobile = await center(44)
  await page.touchscreen.tap(mobile.x, mobile.y)
  assert.equal(await state(44), 'popped', 'native touch pops the targeted pocket')
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'bubble-wrap-mobile.png') })
  const cdp = await page.context().newCDPSession(page)
  const left = await center(49), right = await center(52)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...left, id: 1 }, { ...right, id: 2 }] })
  assert.equal(await state(49), 'popped')
  assert.equal(await state(52), 'popped')
  const endLeft = await center(61), endRight = await center(64)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...endLeft, id: 1 }, { ...endRight, id: 2 }] })
  for (const i of [55, 58, 61, 64]) assert.equal(await state(i), 'popped', 'both fingers pop intervening bubbles')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  const untouched = await center(67)
  await page.mouse.move(untouched.x, untouched.y)
  assert.equal(await state(67), 'ready', 'cancelled input does not leave a drag active')
  await bubble(0).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  assert.equal(await state(1), 'popped', 'keyboard navigation and activation work without visible labels')
  assert.deepEqual(errors, [])
  const silent = await browser.newPage()
  await silent.route(/^https?:/, route => route.abort())
  silent.on('pageerror', error => errors.push(error.message))
  await silent.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined })
  await silent.goto(url)
  await silent.locator('.example-button[data-example="walker"]').click()
  await silent.locator('.bubble-wrap__bubble').nth(20).click()
  assert.equal(await silent.locator('.bubble-wrap__bubble').nth(20).getAttribute('data-state'), 'popped', 'audio restrictions do not break interaction')
  await silent.close()
  assert.deepEqual(errors, [])
  console.log('PASS: full-screen text-free bubble wrap, click/touch, 3 sounds, gradual refill/repop, fast drag, multitouch, keyboard, navigation, resize and silent fallback. No server started.')
} finally {
  await browser?.close()
  await rm(output, { recursive: true, force: true })
}
