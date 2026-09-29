import { test, expect } from '@playwright/test'

test('Rubber Human grabs a face point, rebounds on release, and stops its camera', async ({ page }) => {
  await page.addInitScript(() => {
    window['rubberPinching'] = true
    window['rubberHandX'] = .5
    window['rubberTracks'] = []
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { configurable: true, value: async () => {
      const source = document.createElement('canvas'); source.width = 640; source.height = 480
      const context = source.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, source.width, source.height)
      gradient.addColorStop(0, '#d6ff4f'); gradient.addColorStop(1, '#5945d6')
      context.fillStyle = gradient; context.fillRect(0, 0, source.width, source.height)
      window.setInterval(() => {
        context.fillStyle = `rgba(255,255,255,${performance.now() % 2 ? .001 : .002})`
        context.fillRect(0, 0, 1, 1)
      }, 32)
      const stream = source.captureStream(30)
      window['rubberTracks'].push(...stream.getTracks())
      return stream
    } })
  })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
    const makeFace = () => {
      const face = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
      oval.forEach((landmark, index) => {
        const angle = -Math.PI / 2 + Math.PI * 2 * index / oval.length;
        face[landmark] = { x: .5 + Math.cos(angle) * .22, y: .5 + Math.sin(angle) * .32, z: 0 };
      });
      return face;
    };
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const HandLandmarker = { createFromOptions: async () => ({
      close() {}, detectForVideo() {
        const x = window.rubberHandX;
        const hand = Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }));
        hand[5] = { x: x - .08, y: .55, z: 0 }; hand[17] = { x: x + .08, y: .55, z: 0 };
        hand[4] = { x: x - .006, y: .5, z: 0 };
        hand[8] = { x: window.rubberPinching ? x + .006 : x + .18, y: .5, z: 0 };
        return { landmarks: [hand] };
      }
    }) };
    export const FaceLandmarker = {
      FACE_LANDMARKS_TESSELATION: [{ start: 10, end: 338 }, { start: 338, end: 297 }, { start: 297, end: 10 }],
      createFromOptions: async () => ({ close() {}, detectForVideo() { return { faceLandmarks: [makeFace()] }; } })
    };
  ` }))

  await page.goto('/')
  await page.locator('.example-button[data-example="rubber-human"]').click()
  await page.locator('.rubber-human__start').click()
  await expect(page.locator('.rubber-human')).toHaveClass(/is-ready/)
  await expect(page.locator('.rubber-human')).toHaveAttribute('data-interaction', 'stretching')

  await page.evaluate(() => { window['rubberHandX'] = .7 })
  await page.waitForTimeout(350)
  await expect(page.locator('.rubber-human__mode')).toHaveText('STRETCHING')

  await page.evaluate(() => { window['rubberPinching'] = false })
  await expect(page.locator('.rubber-human')).toHaveAttribute('data-interaction', 'rebounding')
  await expect(page.locator('.rubber-human__mode')).toHaveText('BOUNCE BACK')

  await page.locator('.capture__shutter').click()
  await expect(page.locator('.capture__result')).toBeVisible()
  await expect(page.locator('.capture__preview img')).toBeVisible()
  await page.locator('.capture__close').click()

  await page.locator('.example-button[data-example="heart"]').click()
  await expect.poll(() => page.evaluate(() => window['rubberTracks'].every(track => track.readyState === 'ended'))).toBe(true)
})
