import './water-touch.css'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { coverPoint } from './lemonade-physics'
import { WaterSurface } from './water-surface'
import { createWaterRenderer } from './water-renderer'

type Tip = { x: number; y: number; time: number }
type HandPoint = { x: number; y: number; z: number }
type TrackerMessage =
  | { type: 'ready' }
  | { type: 'result'; timestamp: number; width: number; height: number; landmarks: HandPoint[][] }
  | { type: 'error'; message?: string }
type TestWindow = Window & { waterHands?: unknown[] }
const fingertips = [4, 8, 12, 16, 20]
const base = import.meta.env.BASE_URL
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const constrained = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
const mobileDevice = /Android|iP(?:hone|ad|od)|Mobile/i.test(navigator.userAgent)
const renderCeiling = constrained || mobileDevice ? 720 : 960
const frameInterval = 1000 / (constrained ? 24 : 30)
const detectionInterval = constrained ? 125 : 100

export function createWaterTouch(root: HTMLElement) {
  root.innerHTML = `
    <video class="water-touch__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="water-touch__canvas" aria-label="열 손가락의 물결로 굴절되는 카메라 화면"></canvas>
    <header class="water-touch__header"><p>HAND INTERACTION / 08</p><h2>WaterTouch</h2><span>Make a little ripple.</span></header>
    <div class="water-touch__readout"><span class="water-touch__live">CAMERA OFF</span><span class="water-touch__count" aria-live="polite">0 / 10 FINGERTIPS</span></div>
    <div class="water-touch__gate">
      <div class="water-touch__symbol" aria-hidden="true">◎</div>
      <p class="water-touch__eyebrow">THE WORLD, LIQUID.</p>
      <h3>손끝으로 일으키는 물결</h3>
      <p>두 손을 카메라에 보여 주세요.<br>열 손가락을 움직여 물을 휘저어 보세요.</p>
      <button class="water-touch__start" type="button">카메라 켜기 <span>↗</span></button>
      <small>카메라 화면은 기기 안에서만 처리됩니다.</small>
    </div>
    <p class="water-touch__hint">양손을 펼치고 · 손끝으로 물결 만들기</p>
    <button class="water-touch__reset" type="button">잔잔하게 ↻</button>
    <p class="water-touch__status" role="status" aria-live="polite"></p>
  `
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const canvas = q<HTMLCanvasElement>('.water-touch__canvas')
  const video = q<HTMLVideoElement>('.water-touch__camera')
  const gate = q('.water-touch__gate')
  const start = q<HTMLButtonElement>('.water-touch__start')
  const status = q('.water-touch__status')
  const count = q('.water-touch__count')
  const live = q('.water-touch__live')
  const input = document.createElement('canvas')
  const inputCtx = input.getContext('2d')!
  let active = false
  let paused = false
  let ready = false
  let starting = false
  let capturing = false
  let generation = 0
  let stream: MediaStream | null = null
  let detector: HandLandmarker | null = null
  let trackingWorker: Worker | null = null
  let detecting = false
  let renderer: ReturnType<typeof createWaterRenderer> | null = null
  let surface = new WaterSurface(1)
  let frame = 0
  let lastFrame = 0
  let lastAnimationCallback = 0
  let throttledUntil = 0
  let adaptiveFrameInterval = frameInterval
  let lastDetection = 0
  let lastVideoTime = -1
  let accumulated = 0
  let width = 1
  let height = 1
  let renderScale = 1
  let lastScaleChange = 0
  let fistSettlingUntil = 0
  let tips = new Map<string, Tip>()
  let palms = new Map<number, Tip>()
  let visibleCount = 0

  function setCount(value: number) {
    if (value === visibleCount) return
    visibleCount = value; count.textContent = `${value} / 10 FINGERTIPS`
  }
  function reset() {
    surface = new WaterSurface(width / height, constrained ? 144 : 192)
    tips.clear(); palms.clear(); accumulated = 0; fistSettlingUntil = 0; setCount(0)
  }
  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect()
    const nextWidth = Math.max(1, bounds.width); const nextHeight = Math.max(1, bounds.height)
    const geometryChanged = nextWidth !== width || nextHeight !== height
    width = nextWidth; height = nextHeight
    // The displacement shader is visually identical at this ceiling, while the
    // lower pixel count avoids full-screen GPU stalls and mobile heat.
    const ratio = Math.min(devicePixelRatio || 1, 2, renderCeiling / Math.max(width, height)) * renderScale
    const w = Math.max(2, Math.round(width * ratio / 2) * 2)
    const h = Math.max(2, Math.round(height * ratio / 2) * 2)
    if (canvas.width !== w || canvas.height !== h) renderer?.resize(w, h)
    if (geometryChanged) reset()
    renderer?.draw(ready ? video : null, surface)
  }

  function reduceRenderLoad(now: number) {
    // Portrait phones already use the 720px ceiling; keep their short edge
    // sharp enough for capture while frame pacing handles any remaining load.
    if (mobileDevice || renderScale <= .65 || now - lastScaleChange < 1000) return
    renderScale = Math.max(.64, renderScale * .8); lastScaleChange = now
    const ratio = Math.min(devicePixelRatio || 1, 2, renderCeiling / Math.max(width, height)) * renderScale
    renderer?.resize(Math.max(2, Math.round(width * ratio / 2) * 2), Math.max(2, Math.round(height * ratio / 2) * 2))
  }

  async function enableCamera() {
    if (!active || starting || ready) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = '카메라를 사용하려면 HTTPS 주소를 Safari 또는 Chrome에서 열어 주세요.'
      return
    }
    starting = true; start.disabled = true; start.textContent = '카메라 연결 중…'; status.textContent = ''
    const attempt = ++generation
    let acquired: MediaStream | null = null
    let model: HandLandmarker | null = null
    let phase = 'camera'
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } })
      if (!active || generation !== attempt) { acquired.getTracks().forEach(t => t.stop()); return }
      stream = acquired; video.srcObject = stream; await video.play()
      if (!active || generation !== attempt) { acquired.getTracks().forEach(t => t.stop()); return }
      phase = 'tracking'; start.textContent = '손 트래킹 준비 중…'
      if (Array.isArray((window as TestWindow).waterHands)) {
        // The browser suite injects a deterministic landmarker here. Production
        // always uses the worker path below.
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
        if (!active || generation !== attempt) return
        const options = { runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5 }
        try {
          model = await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${base}mediapipe/hand_landmarker.task`, delegate: 'GPU' } })
        } catch {
          if (!active || generation !== attempt) return
          model = await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${base}mediapipe/hand_landmarker.task`, delegate: 'CPU' } })
        }
        if (!active || generation !== attempt) { model.close(); return }
        detector = model
      } else {
        const { default: HandLandmarkerWorker } = await import('./hand-landmarker.worker?worker&inline')
        const candidate = new HandLandmarkerWorker()
        const assets = new URL(base, location.href).href
        await new Promise<void>((resolve, reject) => {
          candidate.onerror = () => reject(new Error('Worker failed'))
          candidate.onmessage = (event: MessageEvent<TrackerMessage>) => event.data.type === 'ready' ? resolve() : event.data.type === 'error' && reject(new Error(event.data.message || 'Tracker failed'))
          candidate.postMessage({ type: 'init', wasmPath: `${assets}mediapipe/wasm`, modelPath: `${assets}mediapipe/hand_landmarker.task` })
        })
        if (!active || generation !== attempt) { candidate.terminate(); return }
        trackingWorker = candidate
        candidate.onerror = () => failTracking()
        candidate.onmessage = (event: MessageEvent<TrackerMessage>) => {
          if (event.data.type === 'result') {
            detecting = false
            if (active && ready && trackingWorker === candidate) processHands(event.data.landmarks, event.data.timestamp, event.data.width, event.data.height)
          } else if (event.data.type === 'error') failTracking()
        }
      }
      ready = true; gate.hidden = true; root.classList.add('is-ready')
      live.textContent = 'LIVE'; lastVideoTime = -1; lastDetection = 0
      resume()
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream === acquired) { releaseCamera(); status.textContent = '카메라 연결이 끊겼어요. 다시 켜 주세요.' }
      }, { once: true })
    } catch (error) {
      acquired?.getTracks().forEach(t => t.stop()); model?.close()
      if (generation !== attempt) return
      stream = null; video.srcObject = null
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      status.textContent = phase === 'tracking'
        ? '손 인식을 준비하지 못했어요. 다시 시도해 주세요.'
        : denied ? '카메라 권한을 허용해 주세요. 인앱에서 제한되면 Safari 또는 Chrome에서 열어 주세요.'
          : '카메라를 연결하지 못했어요. 다른 앱에서 사용 중인지 확인해 주세요.'
    } finally {
      if (generation !== attempt) acquired?.getTracks().forEach(t => t.stop())
      if (generation === attempt) { starting = false; start.disabled = false; start.innerHTML = '카메라 켜기 <span>↗</span>' }
    }
  }

  function failTracking() {
    if (!active || !ready) return
    releaseCamera(); status.textContent = '손 인식이 중단됐어요. 카메라를 다시 켜 주세요.'
  }

  function processHands(hands: HandPoint[][], now: number, iw: number, ih: number) {
    hands = hands.slice(0, 2)
    const centers = hands.map(points => ({ x: points[9].x, y: points[9].y, time: now }))
    const distance = (a: Tip, b: Tip) => Math.hypot(a.x - b.x, a.y - b.y)
    // Match palms spatially so MediaPipe reordering its results cannot connect
    // a left finger's trail to the right hand on the next frame.
    let slots = [0, 1]
    if (centers.length === 2 && palms.has(0) && palms.has(1)) {
      if (distance(centers[0], palms.get(1)!) + distance(centers[1], palms.get(0)!) < distance(centers[0], palms.get(0)!) + distance(centers[1], palms.get(1)!)) slots = [1, 0]
    } else if (centers.length === 1 && palms.size) {
      slots = [[...palms].sort((a, b) => distance(a[1], centers[0]) - distance(b[1], centers[0]))[0][0]]
    }
    const nextTips = new Map<string, Tip>(); const nextPalms = new Map<number, Tip>()
    hands.forEach((points, hand) => {
      const slot = slots[hand]
      const palmSpan = Math.hypot(points[5].x - points[17].x, points[5].y - points[17].y)
      const fingerReach = ([8, 12, 16, 20] as const).reduce((sum, tip, index) => sum + Math.hypot(points[tip].x - points[[5, 9, 13, 17][index]].x, points[tip].y - points[[5, 9, 13, 17][index]].y), 0) / 4
      const fist = palmSpan > .02 && fingerReach < palmSpan * .62
      // Palm width is stable when fingers curl, so it is a better measure of
      // hand proximity to the camera than fingertip spread.
      const handScale = Math.max(.62, Math.min(2.15, palmSpan / .13))
      const previousPalm = palms.get(slot)
      const palmPoint = coverPoint(points[9], iw, ih, width, height)
      const position = { x: palmPoint.x / width, y: palmPoint.y / height, time: now }
      nextPalms.set(slot, position)
      if (fist && position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1) {
        const continuous = previousPalm && now - previousPalm.time < 250 && Math.hypot(position.x - previousPalm.x, position.y - previousPalm.y) < .3
        const speed = continuous ? Math.hypot(position.x - previousPalm.x, position.y - previousPalm.y) : 0
        // A fist already excites many more cells than one fingertip. Keep its
        // broad impact, but cap amplitude so the remaining wave settles soon.
        const strength = -Math.min(.16, (.068 + Math.min(.065, speed * 1.2)) * Math.sqrt(handScale))
        const radius = Math.max(6, Math.min(12, Math.round(7 * handScale)))
        surface.disturb(position.x, position.y, continuous ? previousPalm.x : position.x, continuous ? previousPalm.y : position.y, strength, radius)
        fistSettlingUntil = now + 1100
        // Keep the existing readout's five-contact convention while rendering
        // one wide palm impact instead of five fingertip impacts.
        fingertips.forEach((index) => nextTips.set(`${slot}:${index}`, position))
        return
      }
      fingertips.forEach((index) => {
        const point = coverPoint(points[index], iw, ih, width, height)
        const x = point.x / width; const y = point.y / height
        if (x < 0 || x > 1 || y < 0 || y > 1) return
        const id = `${slot}:${index}`
        const previous = tips.get(id)
        const continuous = previous && now - previous.time < 250 && Math.hypot(x - previous.x, y - previous.y) < .24
        const position = { x: continuous ? previous.x + (x - previous.x) * .78 : x, y: continuous ? previous.y + (y - previous.y) * .78 : y, time: now }
        const speed = continuous ? Math.hypot(position.x - previous.x, position.y - previous.y) : 0
        const strength = (continuous ? -(.018 + Math.min(.09, speed * 2)) : -.13) * handScale
        surface.disturb(position.x, position.y, continuous ? previous.x : position.x, continuous ? previous.y : position.y, strength)
        nextTips.set(id, position)
      })
    })
    tips = nextTips; palms = nextPalms; setCount(tips.size)
  }

  function track(now: number) {
    if (!ready || (!detector && !trackingWorker) || video.readyState < 2) return
    if (now - lastDetection > 350) { tips.clear(); palms.clear(); setCount(0) }
    if (detecting || now - lastDetection < detectionInterval || video.currentTime === lastVideoTime) return
    lastDetection = now; lastVideoTime = video.currentTime
    const iw = constrained ? 360 : 480; const ih = Math.round(iw * video.videoHeight / video.videoWidth)
    if (input.width !== iw || input.height !== ih) { input.width = iw; input.height = ih }
    inputCtx.setTransform(-1, 0, 0, 1, iw, 0); inputCtx.drawImage(video, 0, 0, iw, ih); inputCtx.resetTransform()
    if (detector) {
      try { processHands(detector.detectForVideo(input, now).landmarks, now, iw, ih) }
      catch { failTracking() }
      return
    }
    detecting = true
    void createImageBitmap(input).then((bitmap) => {
      if (!ready || !trackingWorker) { bitmap.close(); detecting = false; return }
      trackingWorker.postMessage({ type: 'frame', bitmap, timestamp: now, width: iw, height: ih }, [bitmap])
    }).catch(() => failTracking())
  }

  function animate(now: number) {
    if (!active || paused || !ready || document.hidden) return
    frame = requestAnimationFrame(animate)
    const callbackDelay = now - lastAnimationCallback
    lastAnimationCallback = now
    if (callbackDelay > 50) {
      adaptiveFrameInterval = Math.min(100, Math.max(adaptiveFrameInterval, callbackDelay * 1.4))
      throttledUntil = now + 3000
      reduceRenderLoad(now)
    } else if (now > throttledUntil) adaptiveFrameInterval += (frameInterval - adaptiveFrameInterval) * .08
    const elapsed = now - lastFrame
    if (elapsed < adaptiveFrameInterval) return
    lastFrame = now - elapsed % adaptiveFrameInterval
    track(now)
    accumulated += Math.min(elapsed - elapsed % frameInterval, 1000 / 15)
    let steps = 0
    const extraDamping = now < fistSettlingUntil ? .985 : 1
    while (accumulated >= 1000 / 60 && steps++ < 4) { surface.step(extraDamping); accumulated -= 1000 / 60 }
    const renderStart = performance.now()
    renderer?.draw(ready ? video : null, surface)
    const renderCost = performance.now() - renderStart
    // Leave idle time when a software/low-power GPU cannot sustain the target.
    // Fast devices stay at 24–30fps; slower ones reduce only their redraw rate.
    const safeInterval = renderCost > frameInterval * .75
      ? Math.min(100, Math.max(frameInterval, renderCost * 1.6))
      : now < throttledUntil ? adaptiveFrameInterval : frameInterval
    adaptiveFrameInterval += (safeInterval - adaptiveFrameInterval) * .22
  }
  function releaseCamera() {
    ++generation; starting = false; ready = false
    const released = stream; stream = null
    released?.getTracks().forEach(t => t.stop()); video.pause(); video.srcObject = null
    detector?.close(); detector = null; reset()
    trackingWorker?.postMessage({ type: 'close' }); trackingWorker?.terminate(); trackingWorker = null; detecting = false
    gate.hidden = false; root.classList.remove('is-ready'); live.textContent = 'CAMERA OFF'
    start.disabled = false; start.innerHTML = '카메라 켜기 <span>↗</span>'
    renderer?.draw(null, surface)
  }
  function resume() {
    if (!active || paused || document.hidden) return
    cancelAnimationFrame(frame); lastFrame = performance.now(); lastAnimationCallback = lastFrame; throttledUntil = 0; adaptiveFrameInterval = frameInterval; accumulated = 0
    frame = requestAnimationFrame(animate)
  }
  start.addEventListener('click', () => { void enableCamera() })
  q('.water-touch__reset').addEventListener('click', reset)
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) { releaseCamera(); cancelAnimationFrame(frame) } else resume()
  })
  window.addEventListener('pagehide', () => { if (active) { releaseCamera(); cancelAnimationFrame(frame) } })
  window.addEventListener('pageshow', resume)
  return {
    start() {
      if (active) return
      active = true; renderScale = 1; lastScaleChange = 0
      renderer = createWaterRenderer(canvas); renderer.setCapturing(capturing); resize(); resume()
    },
    stop() { if (!active) return; active = false; paused = false; releaseCamera(); cancelAnimationFrame(frame); renderer?.dispose(); renderer = null; status.textContent = '' },
    setPaused(value: boolean) {
      paused = value
      if (paused) {
        cancelAnimationFrame(frame); video.pause(); renderer?.dispose(); renderer = null
      } else if (active) {
        renderer = createWaterRenderer(canvas)
        renderer.setCapturing(capturing)
        if (ready) void video.play().then(resume).catch(() => { releaseCamera(); resume() })
        else resume()
      }
    },
    setCapturing(value: boolean) { capturing = value; renderer?.setCapturing(value) },
    captureFrame() { return renderer?.captureFrame() ?? canvas },
  }
}
