import { test, expect, type Page } from '@playwright/test'

async function prepareLocalCamera(page: Page, withHands = true, withFaces = true) {
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date)
    window['doodleClockOffset'] = 0
    Date.now = () => realNow() + Number(window['doodleClockOffset'] || 0)
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        const source = document.createElement('canvas'); source.width = 960; source.height = 540
        const context = source.getContext('2d')!
        context.fillStyle = '#3f6ec5'; context.fillRect(0, 0, 480, 540)
        context.fillStyle = '#b64f77'; context.fillRect(480, 0, 480, 540)
        context.fillStyle = '#f5c7a9'; context.beginPath(); context.arc(240, 270, 105, 0, Math.PI * 2); context.fill()
        context.beginPath(); context.arc(720, 270, 105, 0, Math.PI * 2); context.fill()
        let tick = 0
        setInterval(() => { context.fillStyle = tick++ % 2 ? '#fff' : '#eee'; context.fillRect(0, 0, 2, 2) }, 40)
        return source.captureStream(24)
      },
    })
  })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    const makeFace = centerX => Array.from({ length: 478 }, (_, index) => ({
      x: centerX + Math.cos(index / 478 * Math.PI * 2) * .105,
      y: .5 + Math.sin(index / 478 * Math.PI * 2) * .21,
      z: 0, visibility: 1
    }));
    export const FaceLandmarker = { createFromOptions: async (files, options) => {
      if (options.numFaces !== 2) throw new Error('DoodleFace must request two faces');
      return { close() {}, detectForVideo() { return { faceLandmarks: ${withFaces ? '[makeFace(.72), makeFace(.28)]' : '[]'} }; } };
    } };
    export const HandLandmarker = { createFromOptions: async (files, options) => {
      if (options.numHands !== 2) throw new Error('DoodleFace must request two hands');
      let playingFrames = 0;
      const makeHand = (side, outside) => {
        const wristX = side === 0 ? .75 : .25;
        const centerX = outside ? (side === 0 ? .525 : .025) : (side === 0 ? .72 : .28);
        const hand = Array.from({ length: 21 }, () => ({ x: wristX, y: .5, z: 0, visibility: 1 }));
        hand[4] = { x: centerX - .01, y: .5, z: 0, visibility: 1 };
        hand[8] = { x: centerX + .01, y: .5, z: 0, visibility: 1 };
        hand[5] = { x: wristX - .08, y: .55, z: 0, visibility: 1 };
        hand[17] = { x: wristX + .08, y: .55, z: 0, visibility: 1 };
        return hand;
      };
      return { close() {}, detectForVideo() {
        if (document.querySelector('.doodle-face')?.dataset.phase === 'playing') playingFrames++;
        if (playingFrames > 0 && playingFrames % 5 === 0) return { landmarks: [] };
        const outside = playingFrames > 6;
        return { landmarks: ${withHands ? '[makeHand(0, outside), makeHand(1, outside)]' : '[]'} };
      } };
    } };
  ` }))
}

async function openDoodleFace(page: Page) {
  await page.goto('/')
  await page.locator('.example-button[data-example="doodle-face"]').click()
}

test('the top menu opens the local DoodleFace lobby', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.example-button')).toHaveCount(14)
  await page.locator('.example-button[data-example="doodle-face"]').click()
  await expect(page.locator('.doodle-face')).toBeVisible()
  await expect(page.locator('.doodle-face__lobby h2')).toHaveText('DoodleFace')
  await expect(page.locator('.doodle-face__create')).toContainText('2인 게임 시작')
  await expect(page.locator('.doodle-face__join')).toContainText('게임 방법')
  await expect(page.locator('.doodle-face__room-code')).toHaveText('LOCAL · 2 PLAYERS')
})

test('one camera recognizes two players and starts without networking', async ({ page }) => {
  await prepareLocalCamera(page, false)
  await openDoodleFace(page)
  await page.locator('.doodle-face__create').click()
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', 'waiting')
  await expect(page.locator('.doodle-face__peer-wait')).toHaveCount(2)
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-player1-face-points', '478', { timeout: 5_000 })
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-player2-face-points', '478')
  await expect(page.locator('.doodle-face__peer-wait').first()).toBeHidden()
  await expect(page.locator('.doodle-face__peer-wait').last()).toBeHidden()
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', /countdown|playing/, { timeout: 3_000 })
})

test('the live camera remains visible while each face is still waiting', async ({ page }) => {
  await prepareLocalCamera(page, false, false)
  await openDoodleFace(page)
  await page.locator('.doodle-face__create').click()
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', 'waiting')
  await expect(page.locator('.doodle-face__peer-wait').first()).toBeVisible()
  await expect.poll(() => page.locator('.doodle-face__camera--left').evaluate((canvas: HTMLCanvasElement) => {
    if (!canvas.width || !canvas.height) return 0
    const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .2), Math.floor(canvas.height * .2), 1, 1).data
    return pixel[0] + pixel[1] + pixel[2]
  })).toBeGreaterThan(200)
  await expect(page.locator('.doodle-face__peer-wait').first()).toHaveCSS('background-color', 'rgba(10, 10, 10, 0.08)')
})

test('the halves swap and both players draw face-anchored strokes through the full round', async ({ page }) => {
  await prepareLocalCamera(page, true)
  await openDoodleFace(page)
  await page.locator('.doodle-face__create').click()
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', 'swapping', { timeout: 8_000 })
  await expect(page.locator('.doodle-face__swap-stage')).toBeVisible()
  await expect.poll(() => page.locator('.doodle-face__swap-frame--left').evaluate(element => getComputedStyle(element).transform)).not.toBe('none')
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', 'playing', { timeout: 2_000 })
  await expect(page.locator('.doodle-face__swap-stage')).toBeHidden()
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-swapped', 'true')
  await expect(page.locator('.doodle-face__timer')).toHaveText(/01:00|00:59/)
  await expect(page.locator('.doodle-face__label').first()).toContainText('PLAYER 2 얼굴에 그리기')
  await expect(page.locator('.doodle-face__label').last()).toContainText('PLAYER 1 얼굴에 그리기')
  await expect.poll(() => page.locator('.doodle-face').evaluate(element => Number((element as HTMLElement).dataset.outsideStrokePoints || 0))).toBeGreaterThan(0)
  for (const selector of ['.doodle-face__canvas--local', '.doodle-face__canvas--remote']) {
    await expect.poll(() => page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let painted = 0
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) painted++
      return painted
    })).toBeGreaterThan(20)
  }
  await page.evaluate(() => { window['doodleClockOffset'] = 61_000 })
  await expect(page.locator('.doodle-face')).toHaveAttribute('data-phase', 'result')
  await expect(page.locator('.doodle-face__center-message')).toBeVisible()
  await expect.poll(() => page.locator('.doodle-face__center-message').evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(450)
  await page.evaluate(() => { window['doodleClockOffset'] = 64_000 })
  await expect(page.locator('.doodle-face__center-message')).toBeHidden()
  await expect(page.locator('.doodle-face__room')).toBeVisible()
  await page.evaluate(() => { window['doodleClockOffset'] = 70_000 })
  await expect(page.locator('.doodle-face__room')).toBeVisible()
  await page.evaluate(() => { window['doodleClockOffset'] = 74_000 })
  await expect(page.locator('.doodle-face__lobby')).toBeVisible()
})
