import { test, expect } from '@playwright/test'

test('Shampoo follows a detected face with a flexible foam crown and releases its camera', async ({ page }) => {
  await page.addInitScript(() => {
    window['shampooFaceX'] = .5
    window['shampooFaceY'] = .16
    window['shampooFaceScale'] = 1
    window['shampooHand'] = null
    window['shampooHands'] = null
    window['shampooFaceDropFrames'] = 0
    window['shampooHandDropFrames'] = 0
    window['shampooLandmarkShift'] = 0
    window['shampooFaceCalls'] = 0
    window['shampooHandCalls'] = 0
    window['shampooTrackerCollisions'] = 0
    window['shampooLastFaceTimestamp'] = -1
    window['shampooLastHandTimestamp'] = -1
    window['shampooTracks'] = []
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { configurable: true, value: async () => {
      const source = document.createElement('canvas'); source.width = 640; source.height = 480
      const context = source.getContext('2d')!
      context.fillStyle = '#5b8c89'; context.fillRect(0, 0, source.width, source.height)
      window.setInterval(() => {
        context.fillStyle = performance.now() % 2 ? '#5b8c89' : '#5b8d89'; context.fillRect(0, 0, 2, 2)
      }, 32)
      const stream = source.captureStream(30)
      window['shampooTracks'].push(...stream.getTracks())
      return stream
    } })
  })
  await page.route('**/*mediapipe_tasks-vision*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const FaceLandmarker = { createFromOptions: async () => ({
      close() {}, detectForVideo(_input, timestamp) {
        window.shampooFaceCalls += 1;
        if (window.shampooLastHandTimestamp === timestamp) window.shampooTrackerCollisions += 1;
        window.shampooLastFaceTimestamp = timestamp;
        if (window.shampooFaceDropFrames > 0) { window.shampooFaceDropFrames -= 1; return { faceLandmarks: [] }; }
        const x = window.shampooFaceX;
        const dy = window.shampooFaceY;
        const scale = window.shampooFaceScale;
        const face = Array.from({ length: 478 }, () => ({ x, y: .5 + dy, z: 0 }));
        face[0] = { x: x + window.shampooLandmarkShift, y: .5 + dy, z: 0 };
        face[10] = { x, y: .5 + dy - .2 * scale, z: 0 }; face[152] = { x, y: .5 + dy + .22 * scale, z: 0 };
        face[234] = { x: x - .17 * scale, y: .5 + dy, z: 0 }; face[454] = { x: x + .17 * scale, y: .5 + dy, z: 0 };
        face[127] = { x: x - .18 * scale, y: .5 + dy - .11 * scale, z: 0 }; face[356] = { x: x + .18 * scale, y: .5 + dy - .11 * scale, z: 0 };
        face[33] = { x: x - .07 * scale, y: .5 + dy - .06 * scale, z: 0 }; face[263] = { x: x + .07 * scale, y: .5 + dy - .06 * scale, z: 0 };
        const hairline = [356, 389, 251, 284, 332, 297, 338, 10, 109, 67, 103, 54, 21, 162, 127];
        hairline.forEach((index, order) => {
          const progress = order / (hairline.length - 1);
          face[index] = { x: x + .18 * scale * (1 - progress * 2), y: .5 + dy - (.11 + Math.sin(progress * Math.PI) * .09) * scale, z: 0 };
        });
        return { faceLandmarks: [face] };
      }
    }) };
    export const HandLandmarker = { createFromOptions: async () => ({
      close() {}, detectForVideo(_input, timestamp) {
        window.shampooHandCalls += 1;
        if (window.shampooLastFaceTimestamp === timestamp) window.shampooTrackerCollisions += 1;
        window.shampooLastHandTimestamp = timestamp;
        if (window.shampooHandDropFrames > 0) { window.shampooHandDropFrames -= 1; return { landmarks: [] }; }
        const states = window.shampooHands ?? (window.shampooHand ? [window.shampooHand] : []);
        if (!states.length) return { landmarks: [] };
        const makeHand = state => {
          const hand = Array.from({ length: 21 }, () => ({ x: state.x, y: state.y + .06, z: 0 }));
          [5, 9, 13, 17].forEach((base, finger) => {
            const x = state.x + (finger - 1.5) * .027;
            hand[base] = { x, y: state.y + .07, z: 0 };
            hand[base + 1] = { x, y: state.y + .025, z: 0 };
            hand[base + 3] = { x, y: state.fist ? state.y + .062 : state.y - .045, z: state.fist ? .012 : 0 };
          });
          hand[5] = { x: state.x - .04, y: state.y + .07, z: 0 };
          hand[17] = { x: state.x + .04, y: state.y + .07, z: 0 };
          if (!state.fist) {
            const gap = state.pinching ? .012 : .06;
            hand[4] = { x: state.x - gap, y: state.y, z: 0 };
            hand[8] = { x: state.x + gap, y: state.y, z: 0 };
          }
          return hand;
        };
        return { landmarks: states.slice(0, 2).map(makeHand) };
      }
    }) };
    export const ImageSegmenter = { createFromOptions: async () => ({
      close() {}, getLabels() { return ['selfie']; }, segmentForVideo(canvas) {
        const width = canvas.width, height = canvas.height;
        const data = new Float32Array(width * height);
        const centerX = window.shampooFaceX * width, dy = window.shampooFaceY, scale = window.shampooFaceScale;
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const nx = (x - centerX) / (width * .2 * scale), ny = (y - height * (.5 + dy - .21 * scale)) / (height * .22 * scale);
          if (nx * nx + ny * ny < 1 || (Math.abs(nx) < .82 && y > height * (.5 + dy - .22 * scale) && y < height * Math.min(.99, .5 + dy + .2 * scale))) data[y * width + x] = .94;
        }
        return { confidenceMasks: [{ width, height, getAsFloat32Array: () => data, close() {} }] };
      }
    }) };
  ` }))

  await page.goto('/')
  await page.locator('.example-button[data-example="shampoo"]').click()
  await page.locator('.shampoo__start').click()
  await expect(page.locator('.shampoo')).toHaveClass(/is-ready/)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-tracking', 'face')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-head-mask', 'human-seg')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-human-seg-mask', 'confidence')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-human-seg-label', 'selfie')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-human-seg-extraction', 'valid')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-hand-tracker', 'main')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-foam-region', 'human-seg-scalp')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-foam-boundary-bleed', '.090')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-foam-boundary-response', 'normal-tangent')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamBoundaryMotion))).toBeGreaterThan(0)
  await expect(page.locator('.shampoo')).not.toHaveAttribute('data-foam-boundary', /.+/)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-foam-column-height', '0')
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM FOLLOW')
  await page.evaluate(() => { window['shampooFaceDropFrames'] = 4 })
  await page.waitForTimeout(360)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-tracking', 'face')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-head-mask', 'human-seg')
  await expect(page.locator('.shampoo')).not.toHaveAttribute('data-foam-boundary', /.+/)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-tracking-failures', '0')
  await expect.poll(() => page.evaluate(() => window['shampooFaceCalls'])).toBeGreaterThan(2)
  await expect.poll(() => page.evaluate(() => window['shampooHandCalls'])).toBeGreaterThan(2)
  expect(await page.evaluate(() => window['shampooTrackerCollisions'])).toBe(0)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => {
    const data = (element as HTMLElement).dataset
    return Number(data.foamTopWidth) < Number(data.foamBaseWidth)
  })).toBe(true)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamForeheadSmoothness))).toBeGreaterThan(.98)
  const initialTopWidth = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamTopWidth))
  const initialBoundaryRatio = await page.locator('.shampoo').evaluate(element => {
    const data = (element as HTMLElement).dataset
    return Number(data.foamTopWidth) / Number(data.foamBaseWidth)
  })
  await page.evaluate(() => { window['shampooFaceScale'] = 1.3 })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamTopWidth))).toBeGreaterThan(initialTopWidth * 1.22)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => {
    const data = (element as HTMLElement).dataset
    return Number(data.foamTopWidth) / Number(data.foamBaseWidth)
  })).toBeCloseTo(initialBoundaryRatio, 2)
  await page.evaluate(() => { window['shampooFaceScale'] = .72 })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamTopWidth))).toBeLessThan(initialTopWidth * .8)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => {
    const data = (element as HTMLElement).dataset
    return Number(data.foamTopWidth) / Number(data.foamBaseWidth)
  })).toBeCloseTo(initialBoundaryRatio, 2)
  await page.evaluate(() => { window['shampooFaceScale'] = 1 })
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: true } })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-sculpting', 'true')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-pulling', 'true')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-grabbed-clusters', '0')
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM PAINT')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(0)
  await page.evaluate(() => { window['shampooHandDropFrames'] = 2 })
  await page.waitForTimeout(150)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-sculpting', 'true')
  await page.evaluate(() => { window['shampooHand'] = { x: .62, y: .34, pinching: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number.parseFloat((element as HTMLElement).style.getPropertyValue('--pinch-x')) / element.clientWidth)).toBeGreaterThan(.55)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-grabbed-clusters', '0')
  await page.evaluate(() => { window['shampooHand'] = { x: .62, y: .34, pinching: false } })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-sculpting', 'false')
  const firstPaintCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))
  await page.waitForTimeout(700)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThanOrEqual(firstPaintCount)
  await page.evaluate(() => {
    window['shampooHand'] = null
    window['shampooHands'] = [
      { x: .45, y: .34, pinching: true },
      { x: .55, y: .34, pinching: true },
    ]
  })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(firstPaintCount)
  await expect(page.locator('.shampoo')).toHaveAttribute('data-hand-count', '2')
  await page.evaluate(() => {
    window['shampooHands'] = [
      { x: .45, y: .34, pinching: true },
      { x: .55, y: .25, pinching: false, fist: true },
    ]
  })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM BLOOM')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-hand-count', '2')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))).toBeGreaterThan(0)
  await page.evaluate(() => {
    window['shampooHands'] = [
      { x: .38, y: .31, pinching: true },
      { x: .64, y: .28, pinching: true },
    ]
  })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM PAINT')
  await page.evaluate(() => { window['shampooHands'] = null; window['shampooHand'] = { x: .5, y: .66, pinching: false } })
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .66, pinching: false } })
  await page.waitForTimeout(240)
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .66, pinching: true } })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM PAINT')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(0)
  await page.waitForTimeout(300)
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .66, pinching: false } })
  const firstStrokeCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))
  await expect(page.locator('.shampoo')).toHaveAttribute('data-attached-landmarks', /\d/)
  const attachedCenter = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedCentroidX))
  await page.evaluate(() => { window['shampooLandmarkShift'] = .04 })
  await expect.poll(() => page.locator('.shampoo').evaluate((element, center) => Math.abs(Number((element as HTMLElement).dataset.attachedCentroidX) - center), attachedCenter)).toBeGreaterThan(.3)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedTrackError))).toBeLessThan(3)
  await page.evaluate(() => { window['shampooLandmarkShift'] = 0 })
  await expect.poll(() => page.locator('.shampoo').evaluate((element, center) => Math.abs(Number((element as HTMLElement).dataset.attachedCentroidX) - center), attachedCenter)).toBeLessThan(4)
  await page.evaluate(() => { window['shampooFaceX'] = .58; window['shampooFaceScale'] = 1.12 })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedCentroidX))).toBeGreaterThan(attachedCenter + 45)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedScale))).toBeGreaterThan(1.07)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedTrackError))).toBeLessThan(3)
  await page.evaluate(() => { window['shampooFaceX'] = .5; window['shampooFaceScale'] = 1 })
  await expect.poll(() => page.locator('.shampoo').evaluate((element, initial) => Math.abs(Number((element as HTMLElement).dataset.foamTopWidth) - initial), initialTopWidth)).toBeLessThan(3)
  await page.evaluate(() => { window['shampooHand'] = { x: .56, y: .62, pinching: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(firstStrokeCount)
  const strokeStartCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))
  await page.waitForTimeout(250)
  await expect.poll(() => page.locator('.shampoo').evaluate((element, initial) => Number((element as HTMLElement).dataset.attachedClusters) >= initial, strokeStartCount)).toBe(true)
  await page.evaluate(() => { window['shampooHand'] = { x: .82, y: .54, pinching: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(strokeStartCount)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedTrackError))).toBeLessThan(3)
  for (let index = 0; index < 12; index += 1) {
    const x = index % 2 ? .78 : .46
    const y = index % 3 === 0 ? .49 : .63
    await page.evaluate(({ x, y }) => { window['shampooHand'] = { x, y, pinching: true } }, { x, y })
    await page.waitForTimeout(85)
  }
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(10)
  const permanentFoamCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))
  await page.waitForTimeout(300)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThanOrEqual(permanentFoamCount)
  await page.evaluate(() => { window['shampooHand'] = { x: .82, y: .54, pinching: false } })
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: false } })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM FOLLOW')
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: true } })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-sculpting', 'true')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-grabbed-clusters', '0')
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: false } })
  await page.evaluate(() => { window['shampooHand'] = null })
  await page.locator('.shampoo__refresh').click()
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBe(0)
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .25, pinching: false, fist: true } })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM BLOOM')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-fist-bloom-span', '.660')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))).toBeGreaterThanOrEqual(5)
  const fistBloomCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))
  const callsAfterFirstFist = await page.evaluate(() => window['shampooHandCalls'])
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .25, pinching: false, fist: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms)), { timeout: 1_500 }).toBeGreaterThan(fistBloomCount)
  await expect.poll(() => page.evaluate(() => window['shampooHandCalls'])).toBeGreaterThan(callsAfterFirstFist)
  const heldFistBloomCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms)), { timeout: 1_500 }).toBeGreaterThan(heldFistBloomCount)
  const continuousFistBloomCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))
  await page.evaluate(() => { window['shampooHand'] = { x: .96, y: .08, pinching: false, fist: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms)), { timeout: 1_500 }).toBeGreaterThan(continuousFistBloomCount)
  const outsideFistBloomCount = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))
  await page.evaluate(() => { window['shampooHand'] = { x: .82, y: .2, pinching: false, fist: false } })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM FOLLOW')
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .25, pinching: false, fist: true } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.fistBlooms))).toBeGreaterThan(outsideFistBloomCount)
  await page.evaluate(() => { window['shampooHand'] = { x: .82, y: .2, pinching: false, fist: false } })
  const clustersAfterRepeatedFist = await page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: true, fist: false } })
  await expect(page.locator('.shampoo__mode')).toHaveText('FOAM PAINT')
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.attachedClusters))).toBeGreaterThan(clustersAfterRepeatedFist)
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .34, pinching: false, fist: false } })
  await page.evaluate(() => { window['shampooHand'] = { x: .5, y: .25, pinching: false } })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-touch-deforming', 'true')
  await page.evaluate(() => { window['shampooHand'] = { x: .58, y: .25, pinching: false } })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamTouchForce))).toBeGreaterThan(1)
  await page.evaluate(() => { window['shampooHand'] = null })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-touch-deforming', 'false', { timeout: 1_500 })
  await page.evaluate(() => { window['shampooFaceX'] = .68 })
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.headMotionSpeed))).toBeGreaterThan(.5)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamPeakBend))).toBeLessThan(1)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamSeamError))).toBeLessThan(.1)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamSeamAlignment))).toBeGreaterThan(.99)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamCurveAlignment))).toBeGreaterThan(.7)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamRenderStepRatio))).toBeLessThan(.061)
  await expect.poll(() => page.locator('.shampoo').evaluate(element => Number((element as HTMLElement).dataset.foamRootError))).toBeLessThan(1)

  await page.locator('.capture__shutter').click()
  await expect(page.locator('.capture__preview img')).toBeVisible()
  await page.locator('.capture__close').click()
  await page.locator('.example-button[data-example="heart"]').click()
  await expect.poll(() => page.evaluate(() => window['shampooTracks'].every(track => track.readyState === 'ended'))).toBe(true)
})

test('the real local HumanSeg model initializes for Shampoo', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Desktop Chromium supplies the real fake-device camera stream.')
  await page.goto('/')
  await page.locator('.example-button[data-example="shampoo"]').click()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.shampoo__start').click()
  await expect(page.locator('.shampoo')).toHaveClass(/is-ready/, { timeout: 30_000 })
  await expect(page.locator('.shampoo')).toHaveAttribute('data-human-seg', 'ready')
  await expect(page.locator('.shampoo')).toHaveAttribute('data-hand-tracker', 'worker')
  expect(errors).toEqual([])
})
