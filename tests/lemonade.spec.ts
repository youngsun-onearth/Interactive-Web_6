import { test, expect } from '@playwright/test'

async function openLemonade(page) {
  await page.goto('/')
  await page.locator('.example-button[data-example="lemonade"]').click()
}
async function mockCameraAndHands(page, delay = 0) {
  await page.addInitScript(({ delay }) => {
    window['testHands'] = []
    window['testTracks'] = []
    const ellipse = CanvasRenderingContext2D.prototype.ellipse
    CanvasRenderingContext2D.prototype.ellipse = function (...args) {
      if (this.canvas.classList.contains('lemonade__canvas') && args[3] === 7) {
        const matrix = this.getTransform()
        window['testCup'] = { x: matrix.e / (this.canvas.width / this.canvas.clientWidth), y: matrix.f / (this.canvas.height / this.canvas.clientHeight) }
      }
      return ellipse.apply(this, args)
    }
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: async () => {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
      const ctx = canvas.getContext('2d')!
      const paint = () => { ctx.fillStyle = '#697968'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#c5ccbb'; ctx.fillRect(0, 230, 640, 10) }
      paint(); const interval = setInterval(paint, 33)
      const stream = canvas.captureStream(30)
      window['testTracks'].push(...stream.getTracks())
      const stop = stream.getTracks()[0].stop.bind(stream.getTracks()[0])
      stream.getTracks()[0].stop = () => { clearInterval(interval); stop() }
      return stream
    } })
  }, { delay })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const HandLandmarker = { createFromOptions: async () => ({
      close() {},
      detectForVideo() {
        const hands = window.testHands || [];
        return {
          handedness: hands.map(h => [{categoryName: h.side, score: .99}]),
          landmarks: hands.map(h => Array.from({length: 21}, () => ({x: h.x, y: h.y, z: 0}))),
          worldLandmarks: hands.map(h => {
            const points = Array.from({length: 21}, () => ({x: 0, y: 0, z: 0}));
            for (const i of [5,9,13,17]) { points[i] = {x: i/100,y:0,z:0}; points[i+1] = {x:i/100,y:-1,z:0}; points[i+3] = {x:i/100,y:h.closed ? -.1 : -2,z:0}; }
            return points;
          })
        };
      }
    }) };
    export const FaceLandmarker = { createFromOptions: async () => ({
      close() {},
      detectForVideo() {
        const face = Array.from({length: 478}, () => ({x: .5, y: .5, z: 0}));
        return { faceLandmarks: [face] };
      }
    }) };
  ` }))
}
async function startMock(page) {
  await mockCameraAndHands(page)
  await openLemonade(page)
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade')).toHaveClass(/is-ready/)
}

test('all thirteen panels switch without spawning heart effects in Lemonade', async ({ page }) => {
  await openLemonade(page)
  await expect(page.locator('.example-button')).toHaveCount(14)
  await expect(page.locator('.lemonade')).toBeVisible()
  await page.locator('.lemonade__reset').click()
  await expect(page.locator('.heart')).toHaveCount(0)
  await expect(page.locator('.capture__shutter')).toBeEnabled()
  await page.locator('.example-button[data-example="gaze"]').click()
  await expect(page.locator('.lemonade')).toBeHidden()
  await expect(page.locator('.gaze-example')).toBeVisible()
  await page.locator('.example-button[data-example="sampler"]').click()
  await expect(page.locator('.sampler')).toBeVisible()
})

test('camera permission rejection is recoverable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: async () => { throw new DOMException('denied', 'NotAllowedError') } }))
  await openLemonade(page)
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade__status')).toContainText('권한')
  await expect(page.locator('.lemonade__start')).toBeEnabled()
})

test('short press produces a downloadable composite photo', async ({ page }) => {
  await startMock(page)
  await page.locator('.capture__shutter').click()
  await expect(page.locator('.capture__result')).toBeVisible()
  await expect(page.locator('.capture__preview img')).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.locator('.capture__download').click()
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/^Lemonade-.*\.png$/)
  expect(await file.failure()).toBeNull()
  expect(await page.locator('.capture__preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(300)
})

test('long press records until the next press and produces a playable video', async ({ page }) => {
  await startMock(page)
  const shutter = page.locator('.capture__shutter')
  await shutter.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await expect(shutter).toHaveClass(/is-recording/)
  await expect(page.locator('.capture__timer')).toHaveText('00:02', { timeout: 8000 })
  await shutter.click()
  await expect(page.locator('.capture__result')).toBeVisible()
  const video = page.locator('.capture__preview video')
  await expect(video).toBeVisible()
  await video.evaluate((v: HTMLVideoElement) => v.play())
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  const filename = await page.locator('.capture__download').getAttribute('download')
  expect(filename).toMatch(/\.(mp4|webm)$/)
  const duration = await video.evaluate((v: HTMLVideoElement) => v.duration)
  expect(duration).toBeGreaterThan(1)
})

test('cancelling a pointer does not take a photo', async ({ page }) => {
  await startMock(page)
  const shutter = page.locator('.capture__shutter')
  await shutter.hover(); await page.mouse.down()
  await shutter.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up()
  await page.waitForTimeout(600)
  await expect(page.locator('.capture__result')).not.toBeVisible()
  await expect(shutter).not.toHaveClass(/is-recording/)
})

test('leaving the example releases camera tracks, including a pending permission request', async ({ page }) => {
  await mockCameraAndHands(page, 300)
  await openLemonade(page)
  await page.locator('.lemonade__start').click()
  await page.locator('.example-button[data-example="gaze"]').click()
  await expect.poll(() => page.evaluate(() => window['testTracks'].length)).toBe(1)
  await expect.poll(() => page.evaluate(() => window['testTracks'][0].readyState)).toBe('ended')
  await page.locator('.example-button[data-example="lemonade"]').click()
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade')).toHaveClass(/is-ready/)
  await page.locator('.example-button[data-example="heart"]').click()
  expect(await page.evaluate(() => window['testTracks'].every(t => t.readyState === 'ended'))).toBe(true)
})

test('synthetic left fist squeezes juice into the centered cup; lost hands clear indicators', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Landscape geometry is exercised here; portrait mapping has unit coverage.')
  await page.setViewportSize({ width: 1280, height: 720 })
  await startMock(page)
  await page.evaluate(() => { window['testHands'] = [{ side: 'Left', x: .375, y: .35, closed: true }] })
  await expect(page.locator('.lemonade__hand--left')).toHaveClass(/is-squeezing/)
  await page.evaluate(() => { window['testHands'] = [{ side: 'Left', x: .5, y: .35, closed: true }] })
  await expect.poll(async () => Number((await page.locator('.lemonade__volume').textContent())?.split(' / ')[0]), { timeout: 8000 }).toBeGreaterThan(20)
  await expect(page.locator('.lemonade__hand--left')).not.toHaveClass(/is-squeezing/, { timeout: 6000 })
  expect(Number((await page.locator('.lemonade__volume').textContent())?.split(' / ')[0])).toBeLessThanOrEqual(100)
  await page.evaluate(() => { window['testHands'] = [{ side: 'Right', x: .7, y: .7, closed: false }] })
  await expect(page.locator('.lemonade__hand--right')).toHaveClass(/is-tracked/)
  await expect.poll(() => page.evaluate(() => Math.round(window['testCup'].x))).toBe(896)
  await page.evaluate(() => { window['testHands'] = [] })
  await expect(page.locator('.lemonade__hand--right')).not.toHaveClass(/is-tracked/)
  await expect.poll(() => page.evaluate(() => Math.round(window['testCup'].x))).toBe(640)
  await expect(page.locator('.lemonade__hand--left')).not.toHaveClass(/is-squeezing/)
})

test('a full lemonade gains a straw and drains when it reaches the detected mouth', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The synthetic cup and face positions use desktop landscape geometry.')
  await page.setViewportSize({ width: 1280, height: 720 })
  await mockCameraAndHands(page)
  await page.route('**/lemonade/config.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ image: 'lemon.png', lemonCount: 2, juicePerLemon: 400, cupCapacity: 300 }) }))
  await openLemonade(page)
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade')).toHaveClass(/is-ready/)
  await page.evaluate(() => { window['testHands'] = [{ side: 'Left', x: .375, y: .35, closed: true }] })
  await expect(page.locator('.lemonade__hand--left')).toHaveClass(/is-squeezing/)
  await page.evaluate(() => { window['testHands'] = [{ side: 'Left', x: .5, y: .35, closed: true }] })
  await expect.poll(async () => Number((await page.locator('.lemonade__volume').textContent())?.split(' / ')[0]), { timeout: 15_000 }).toBe(300)
  // Move the cup upward until its straw tip meets the centred synthetic mouth.
  await page.evaluate(() => { window['testHands'] = [{ side: 'Right', x: .5, y: .7, closed: false }] })
  await expect(page.locator('.lemonade')).toHaveClass(/is-drinking/, { timeout: 8_000 })
  await expect.poll(async () => Number((await page.locator('.lemonade__volume').textContent())?.split(' / ')[0]), { timeout: 5_000 }).toBeLessThan(270)
})

test('real local MediaPipe model initializes against the browser test camera', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Real camera fixture is provided by desktop Chromium.')
  await openLemonade(page)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade')).toHaveClass(/is-ready/, { timeout: 30000 })
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})


test('keyboard shutter takes one photo and can start and stop recording', async ({ page }) => {
  await startMock(page)
  const shutter = page.locator('.capture__shutter')
  await shutter.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.capture__result')).toBeVisible()
  await page.locator('.capture__close').click()
  await shutter.focus()
  await page.keyboard.down(' '); await page.waitForTimeout(650); await page.keyboard.up(' ')
  await expect(shutter).toHaveClass(/is-recording/)
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await expect(page.locator('.capture__preview video')).toBeVisible()
})

test('rotating during recording preserves the output dimensions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await startMock(page)
  const shutter = page.locator('.capture__shutter')
  await shutter.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await expect(shutter).toHaveClass(/is-recording/)
  const dimensions = await page.locator('.lemonade__canvas').evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }))
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(800)
  await shutter.click()
  const movie = page.locator('.capture__preview video')
  await expect(movie).toBeVisible()
  // WebKit can defer portrait-video metadata until the user starts playback.
  await movie.evaluate((v: HTMLVideoElement) => v.play())
  await expect.poll(() => movie.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(dimensions.width)
  expect(await movie.evaluate((v: HTMLVideoElement) => v.videoHeight)).toBe(dimensions.height)
})
