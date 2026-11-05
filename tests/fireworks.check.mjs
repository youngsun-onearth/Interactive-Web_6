// Open a temporary static build directly. No development or preview server.
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { chromium } from '@playwright/test'

const output = await mkdtemp(path.join(tmpdir(), 'fireworks-check-'))
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
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href)
  await page.locator('.cloud-title').waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.getByRole('heading', { name: '바이브코딩 워크숍' }).count(), 1)
  assert.equal(await page.locator('.example-button:visible').count(), 6)
  assert.equal(await page.locator('.guestbook-link').isVisible(), false)
  assert.equal(await page.locator('.capture').count(), 0)

  const pixelStats = selector => page.locator(selector).evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0, left = canvas.width, right = 0, top = canvas.height, bottom = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 20) continue
      const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width)
      count++; left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    return { count, left, right, top, bottom, span: right - left }
  })
  const particles = () => pixelStats('.fireworks-canvas')
  assert((await pixelStats('.cloud-title__canvas')).count > 1500, 'cloud letters render without external fonts')
  assert.equal((await particles()).count, 0, 'idle sky has no active particles')
  const screenshots = process.env.FIREWORKS_SCREENSHOT_DIR
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: path.join(screenshots, 'fireworks-desktop.png') })
  }

  // Fix the random shape and speed so only press duration changes burst size.
  await page.evaluate(() => { Math.random = () => 0.25 })
  await page.mouse.click(640, 420)
  await page.waitForTimeout(160)
  const short = await particles()
  assert(short.count > 100, 'click produces visible sparks')
  assert(Math.abs((short.left + short.right) / 2 - 640) < 12, 'burst stays centered on the pressed point')
  await page.waitForTimeout(2200)
  assert.equal((await particles()).count, 0, 'expired particles are removed')
  await page.mouse.move(640, 420)
  await page.mouse.down()
  await page.waitForTimeout(1800)
  assert((await particles()).count > 50, 'holding shows charge feedback')
  await page.mouse.up()
  await page.waitForTimeout(160)
  const long = await particles()
  assert(long.span > short.span * 2.5, 'long press produces a substantially larger burst')
  if (screenshots) {
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(screenshots, 'fireworks-burst.png') })
  }

  const reset = async () => {
    await page.locator('[data-example="walker"].example-button').click()
    assert.equal((await particles()).count, 0, 'switching examples clears effects')
    await page.locator('.example-menu-toggle').click()
    await page.locator('[data-example="heart"].example-button').click()
  }
  await reset()
  await page.mouse.move(500, 400)
  assert.equal((await particles()).count, 0, 'moving the mouse alone does not launch fireworks')
  await page.mouse.click(500, 400, { button: 'right' })
  assert.equal((await particles()).count, 0, 'secondary clicks do not launch fireworks')
  for (const value of [0.05, 0.25, 0.45, 0.65, 0.85]) {
    await page.evaluate(value => { Math.random = () => value }, value)
    await page.mouse.click(640, 420)
    await page.waitForTimeout(160)
    assert((await particles()).count > 50, 'each randomly selected burst shape renders')
    await reset()
  }
  await page.evaluate(() => { Math.random = () => 0.25 })
  await page.mouse.move(180, 250)
  await page.mouse.down()
  await page.mouse.move(620, 250, { steps: 8 })
  await page.mouse.move(620, 650, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(80)
  const earlyDrag = await particles()
  assert(earlyDrag.count > 50 && earlyDrag.right < 400 && earlyDrag.bottom < 350, 'drag chain starts at the beginning, not the release point')
  await page.waitForTimeout(950)
  const completedDrag = await particles()
  assert(completedDrag.right > 620 && completedDrag.bottom > 650, 'chain reaches the end of the recorded path')
  const shortcutPixels = await page.locator('.fireworks-canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(390, 440, 20, 20).data
    return data.some((value, index) => index % 4 === 3 && value > 20)
  })
  assert.equal(shortcutPixels, false, 'chain follows the corner instead of taking a diagonal shortcut')
  await reset()
  await page.mouse.move(180, 250)
  await page.mouse.down()
  await page.mouse.move(1000, 650, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(80)
  await reset()
  await page.waitForTimeout(1000)
  assert.equal((await particles()).count, 0, 'switching examples cancels queued bursts as well as active sparks')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.touchscreen.tap(195, 380)
  await page.waitForTimeout(160)
  assert((await particles()).count > 50, 'real touch produces a burst')
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'fireworks-mobile.png') })
  await reset()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 350, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 290, y: 550, id: 1 }] })
  await page.waitForTimeout(150)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await page.waitForTimeout(100)
  assert.equal((await particles()).count, 0, 'cancelled touch does not launch a burst')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 300, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 310, y: 550, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(80)
  assert((await particles()).right < 200, 'touch drag also begins at its starting point')
  await page.waitForTimeout(650)
  const touchDrag = await particles()
  assert(touchDrag.right > 310 && touchDrag.bottom > 550, 'fast touch drags fill gaps along the full path')
  await reset()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 350, id: 1 }, { x: 290, y: 500, id: 2 }] })
  await page.waitForTimeout(150)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(160)
  const multi = await particles()
  assert(multi.left < 100 && multi.right > 290, 'multiple fingers launch independent fireworks')
  await page.locator('[data-example="gaze"].example-button').click()
  await page.mouse.click(195, 380)
  assert.equal((await particles()).count, 0, 'other examples never launch fireworks')
  assert.notEqual(await page.locator('.gaze-character').getAttribute('data-expression'), 'neutral')
  assert.deepEqual(errors, [])
  console.log(`PASS: cloud title, click position, long-press size (${short.span}px → ${long.span}px), ordered mouse/touch drag chains, bends, queued-burst cleanup, multitouch, cancellation and gaze example. No server started.`)
} finally {
  await browser?.close()
  await rm(output, { recursive: true, force: true })
}
