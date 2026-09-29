import { test, expect } from '@playwright/test'

for (const mode of ['heart', 'walker', 'gaze', 'typing', 'claw', 'sampler', 'lemonade', 'water']) {
  test(`shared shutter captures ${mode} without camera permission`, async ({ page }) => {
    if (mode === 'claw') test.setTimeout(120000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.locator(`.example-button[data-example="${mode}"]`).click()
    if (mode === 'claw') await expect(page.locator('.claw-machine__viewport canvas')).toBeVisible({ timeout: 90000 })
    const shutter = page.locator('.capture__shutter')
    await expect(shutter).toHaveCount(1)
    await expect(shutter).toBeVisible()
    await expect(shutter).toBeEnabled()
    const box = await shutter.boundingBox()
    expect(Math.abs(box!.x + box!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(3)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await shutter.click()
    await expect(page.locator('.capture__result')).toBeVisible({ timeout: 20000 })
    const img = page.locator('.capture__preview img')
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(300)
    // Inspect the composited preview; WebKit can defer a second canvas readback.
    await img.evaluate((el: HTMLImageElement) => el.decode())
    expect((await img.screenshot()).byteLength).toBeGreaterThan(2000)
    expect(errors).toEqual([])
  })
}

test('recording continues across examples and the shutter does not activate sampler shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 391, height: 845 })
  await page.goto('/')
  const shutter = page.locator('.capture__shutter')
  await shutter.hover(); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up()
  await expect(shutter).toHaveClass(/is-recording/, { timeout: 20000 })
  await page.locator('.example-button[data-example="sampler"]').click()
  await expect(shutter).toHaveClass(/is-recording/)
  await page.waitForTimeout(1100)
  await shutter.focus(); await page.keyboard.press('Space')
  await expect(page.locator('.capture__result')).toBeVisible()
  await expect(page.locator('.sampler__loop-record')).toHaveAttribute('aria-pressed', 'false')
  const video = page.locator('.capture__preview video')
  await video.evaluate((v: HTMLVideoElement) => v.play())
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(300)
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth % 2)).toBe(0)
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoHeight % 2)).toBe(0)
})
