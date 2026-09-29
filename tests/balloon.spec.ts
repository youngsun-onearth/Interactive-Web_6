import { test, expect } from '@playwright/test'

test('Balloon starts its full-screen camera scene and releases it when leaving', async ({ page }) => {
  await page.addInitScript(() => {
    window['balloonTracks'] = []
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { configurable: true, value: async () => {
      const source = document.createElement('canvas'); source.width = 640; source.height = 480
      const context = source.getContext('2d')!
      context.fillStyle = '#2d5874'; context.fillRect(0, 0, source.width, source.height)
      const stream = source.captureStream(30)
      window['balloonTracks'].push(...stream.getTracks())
      return stream
    } })
  })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const HandLandmarker = { createFromOptions: async () => ({ close() {}, detectForVideo() { return { landmarks: [] }; } }) };
    export const FaceLandmarker = { createFromOptions: async () => ({
      close() {},
      detectForVideo() {
        const face = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
        return { faceLandmarks: [face] };
      }
    }) };
  ` }))
  await page.goto('/')
  await page.locator('[data-example="balloon"].example-button').click()
  await page.locator('.balloon__start').click()
  await expect(page.locator('.balloon')).toHaveClass(/is-ready/)
  await expect(page.locator('.balloon__canvas')).toBeVisible()
  await expect(page.locator('.balloon__count')).toHaveText(/BALLOONS/)
  await page.locator('[data-example="heart"].example-button').click()
  await expect.poll(() => page.evaluate(() => window['balloonTracks'].every(track => track.readyState === 'ended'))).toBe(true)
})
