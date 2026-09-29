import { test, expect } from '@playwright/test'

test('explains video capture fallback when the browser has no MediaRecorder', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined })
  })
  await page.goto('/')
  const shutter = page.locator('.capture__shutter')
  await shutter.hover()
  await page.mouse.down()
  await page.waitForTimeout(520)
  await page.mouse.up()
  await expect(page.locator('.capture__status')).toContainText('Safari, Chrome, Edge 또는 Firefox')
  await expect(shutter).not.toHaveClass(/is-recording/)
})

test('guides denied KakaoTalk in-app camera users to an external browser', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 AppleWebKit/605.1.15 KAKAOTALK/25.7.0 INAPP',
    })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError') },
    })
  })
  await page.goto('/')
  await page.locator('.example-button[data-example="lemonade"]').click()
  await page.locator('.lemonade__start').click()
  await expect(page.locator('.lemonade__status')).toContainText('Safari 또는 Chrome')
  await expect(page.locator('.lemonade__gate')).toBeVisible()
})

test('guides denied Instagram in-app WaterTouch users to an external browser', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 AppleWebKit/605.1.15 Instagram 410.0.0.0.0',
    })
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Permission denied', 'NotAllowedError') },
    })
  })
  await page.goto('/')
  await page.locator('.example-button[data-example="water"]').click()
  await page.locator('.water-touch__start').click()
  await expect(page.locator('.water-touch__status')).toContainText('Safari 또는 Chrome')
  await expect(page.locator('.water-touch__gate')).toBeVisible()
})
