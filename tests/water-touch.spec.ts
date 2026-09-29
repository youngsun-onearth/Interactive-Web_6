import { test, expect } from '@playwright/test'

async function setup(page, fallback = false, delay = 0) {
  await page.addInitScript(({ fallback, delay }) => {
    window['waterHands'] = []
    window['waterTracks'] = []
    window['waterClosed'] = 0
    if (fallback) {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (String(type).startsWith('webgl')) return null
        return getContext.call(this, type, ...args)
      }
    }
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { configurable: true, value: async () => {
      await new Promise(resolve => setTimeout(resolve, delay))
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
      const ctx = canvas.getContext('2d')!
      const paint = () => {
        for (let y = 0; y < 480; y += 16) for (let x = 0; x < 640; x += 16) {
          ctx.fillStyle = (x / 16 + y / 16) % 2 ? '#e8eff5' : '#244b61'
          ctx.fillRect(x, y, 16, 16)
        }
        ctx.fillStyle = '#ff4433'; ctx.fillRect(0, 0, 640, 25)
      }
      paint(); const timer = setInterval(paint, 33)
      const stream = canvas.captureStream(30)
      window['waterTracks'].push(...stream.getTracks())
      const track = stream.getTracks()[0]; const stop = track.stop.bind(track)
      track.stop = () => { clearInterval(timer); stop() }
      return stream
    } })
  }, { fallback, delay })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const HandLandmarker = { createFromOptions: async (files, options) => {
      window.waterNumHands = options.numHands;
      return { close() { window.waterClosed++; }, detectForVideo() {
        return { landmarks: window.waterHands.map(hand => {
          const points = Array.from({ length: 21 }, () => ({ x: hand.x, y: hand.y, z: 0 }));
          [4,8,12,16,20].forEach((i, finger) => { points[i] = { x: hand.x + (finger - 2) * .025, y: hand.y + Math.abs(finger - 2) * .025, z: 0 }; });
          return points;
        }) };
      } };
    } };
  ` }))
  await page.goto('/')
  await page.locator('[data-example="water"].example-button').click()
  await page.locator('.water-touch__start').click()
}

for (const fallback of [false, true]) {
  test(`ten fingertips refract camera pixels and disappear cleanly (${fallback ? 'Canvas' : 'WebGL'})`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await setup(page, fallback)
    await expect(page.locator('.water-touch')).toHaveClass(/is-ready/)
    await page.waitForTimeout(150)
    const waterCanvas = page.locator('.water-touch__canvas')
    const before = await waterCanvas.screenshot()
    await page.evaluate(() => { window['waterHands'] = [{ x: .42, y: .45 }, { x: .58, y: .5 }] })
    await expect(page.locator('.water-touch__count')).toHaveText('10 / 10 FINGERTIPS')
    expect(await page.evaluate(() => window['waterNumHands'])).toBe(2)
    await page.evaluate(() => { window['waterHands'] = [{ x: .47, y: .35 }, { x: .53, y: .6 }] })
    await expect.poll(async () => Buffer.compare(await waterCanvas.screenshot(), before)).not.toBe(0)
    await page.screenshot({ path: test.info().outputPath('water-motion.png') })
    await page.evaluate(() => { window['waterHands'] = [] })
    await expect(page.locator('.water-touch__count')).toHaveText('0 / 10 FINGERTIPS')
    await page.locator('.water-touch__reset').click()
    await expect(page.locator('.heart')).toHaveCount(0)
    await page.locator('[data-example="heart"].example-button').click()
    expect(await page.evaluate(() => window['waterTracks'].every(t => t.readyState === 'ended'))).toBe(true)
    expect(await page.evaluate(() => window['waterClosed'])).toBe(1)
    expect(errors).toEqual([])
  })
}

test('water photo and video export the refracted camera', async ({ page }) => {
  await setup(page)
  await expect(page.locator('.water-touch')).toHaveClass(/is-ready/)
  await page.evaluate(() => { window['waterHands'] = [{ x: .5, y: .5 }] })
  await expect(page.locator('.water-touch__count')).toHaveText('5 / 10 FINGERTIPS')
  const shutter = page.locator('.capture__shutter')
  await shutter.click()
  await expect(page.locator('.capture__preview img')).toBeVisible()
  await expect(page.locator('.capture__download')).toHaveAttribute('download', /^WaterTouch-.*\.png$/)
  await page.locator('.capture__close').click()
  await shutter.hover(); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up()
  await expect(shutter).toHaveClass(/is-recording/)
  await page.waitForTimeout(2200); await shutter.click()
  const video = page.locator('.capture__preview video')
  await expect(video).toBeVisible()
  const saving = page.waitForEvent('download')
  await page.locator('.capture__download').click()
  const download = await saving
  await download.saveAs(test.info().outputPath(download.suggestedFilename()))
  await video.evaluate((v: HTMLVideoElement) => { void v.play() })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10000 }).toBeGreaterThanOrEqual(2)
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(300)
  // A decodable green/blank video is still a failure: verify scene detail.
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.pause()
    const target = Math.min(1, Math.max(0, v.duration / 2))
    if (Math.abs(v.currentTime - target) >= .05) await new Promise<void>((resolve) => {
        v.addEventListener('seeked', () => resolve(), { once: true })
        v.currentTime = target
      })
    if ('requestVideoFrameCallback' in v) await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 500)
      v.requestVideoFrameCallback(() => { clearTimeout(fallback); resolve() })
    })
  })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120
    const ctx = canvas.getContext('2d')!; ctx.drawImage(v, 0, 0, 160, 120)
    const pixels = ctx.getImageData(0, 0, 160, 120).data
    let min = 255; let max = 0
    for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]) }
    return max - min
  }), { timeout: 5000 }).toBeGreaterThan(80)
  await page.locator('.capture__close').click()
  await expect.poll(() => page.locator('.water-touch__camera').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  await expect(page.locator('.water-touch__count')).toHaveText('5 / 10 FINGERTIPS')
})

test('leaving during pending permission stops the late camera', async ({ page }) => {
  await setup(page, false, 500)
  await page.locator('[data-example="lemonade"].example-button').click()
  await expect.poll(() => page.evaluate(() => window['waterTracks'].length)).toBe(1)
  expect(await page.evaluate(() => window['waterTracks'][0].readyState)).toBe('ended')
  await page.locator('[data-example="water"].example-button').click()
  await expect(page.locator('.water-touch__start')).toBeEnabled()
})

test('camera denial is recoverable in WaterTouch', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: async () => { throw new DOMException('denied', 'NotAllowedError') } }))
  await page.goto('/')
  await page.locator('[data-example="water"].example-button').click()
  await page.locator('.water-touch__start').click()
  await expect(page.locator('.water-touch__status')).toContainText('권한')
  await expect(page.locator('.water-touch__start')).toBeEnabled()
})

test('real MediaPipe model initializes for WaterTouch', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Desktop Chromium supplies a real fake-device camera stream.')
  await page.goto('/')
  await page.locator('[data-example="water"].example-button').click()
  await page.locator('.water-touch__start').click()
  await expect(page.locator('.water-touch')).toHaveClass(/is-ready/, { timeout: 30000 })
})
