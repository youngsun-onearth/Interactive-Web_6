import './style.css'
import { VideoFrameSource, releaseTrackingFrame, trackingFrameTransfer, type TrackingFrame } from '../vision-frame'
import { SnowSimulation } from './simulation'
import { SNOW_LIMIT, LOW_POWER_SNOW_LIMIT } from './simulation-protocol'
import { FogGlass } from './fog'
import { CloudSky } from './clouds'
import { clamp, indexExtended, screenPoint } from './types'
import type { Point, TrackingMessage } from './types'

type Finger = { point: Point; drawn: Point; seen: number; radius: number }
type Mouth = { point: Point; width: number; open: boolean; since: number; seen: number }
const BASE = import.meta.env.BASE_URL

function makeCrystal() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48
  const ctx = canvas.getContext('2d')!
  ctx.translate(24, 24); ctx.strokeStyle = '#f5fcff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
  ctx.shadowColor = '#bfeaff'; ctx.shadowBlur = 3
  for (let arm = 0; arm < 6; arm++) {
    ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18)
    ctx.moveTo(-6, -15); ctx.lineTo(0, -10); ctx.lineTo(6, -15)
    ctx.moveTo(-4, -9); ctx.lineTo(0, -5); ctx.lineTo(4, -9); ctx.stroke()
  }
  return canvas
}

export function createSnow(root: HTMLElement) {
  root.innerHTML = `
    <video class="snow__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="snow__canvas" aria-label="구름을 찌르면 몸에 쌓이는 눈과 손가락으로 지울 수 있는 입김"></canvas>
    <div class="snow__gate">
      <span aria-hidden="true">❄</span><h1>Snow</h1>
      <p>구름을 검지로 콕 찔러 보세요.<br>눈이 오면 입을 벌려 김을 만들고,<br>손끝으로 나만의 그림을 그려요.</p>
      <button class="snow__start" type="button">카메라 켜기 ↗</button>
    </div>
    <p class="snow__status" role="status" aria-live="polite"></p>
  `
  const video = root.querySelector<HTMLVideoElement>('video')!
  video.muted = true; video.autoplay = true; video.playsInline = true
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!, output = canvas.getContext('2d')!
  const scene = document.createElement('canvas'), ctx = scene.getContext('2d', { alpha: false })!
  const gate = root.querySelector<HTMLElement>('.snow__gate')!, startButton = root.querySelector<HTMLButtonElement>('.snow__start')!
  const status = root.querySelector<HTMLElement>('.snow__status')!
  const crystal = makeCrystal(), fog = new FogGlass(), sky = new CloudSky()
  const constrained = (navigator.hardwareConcurrency || 8) <= 4 || Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
  const frameSource = new VideoFrameSource()
  const physics = new SnowSimulation(constrained ? LOW_POWER_SNOW_LIMIT : SNOW_LIMIT)
  root.dataset.snowLimit = String(physics.limit)
  const fingers = new Map<string, Finger>()
  const capture = document.createElement('canvas'), captureContext = capture.getContext('2d')!
  let active = false, paused = false, starting = false, ready = false, generation = 0
  let stream: MediaStream | null = null, worker: Worker | null = null
  let frame = 0, lastFrame = 0, lastInference = -Infinity, videoTime = -1, pending = false
  let watchdog = 0, cancelInitialization: (() => void) | null = null
  let width = 1, height = 1, ratio = 1, mouth: Mouth | null = null

  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect(), nextWidth = Math.max(1, bounds.width), nextHeight = Math.max(1, bounds.height)
    const nextRatio = Math.min(devicePixelRatio || 1, 2, (constrained ? 1600 : 2560) / Math.max(nextWidth, nextHeight))
    if (width === nextWidth && height === nextHeight && ratio === nextRatio && canvas.width > 1) return
    width = nextWidth; height = nextHeight
    ratio = nextRatio
    canvas.width = scene.width = Math.round(width * ratio); canvas.height = scene.height = Math.round(height * ratio)
    for (const context of [ctx, output]) { context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high' }
    physics.resize(width, height); fog.resize(width, height)
    sky.resize(width, height); fingers.clear(); mouth = null
  }
  function stopTracker() {
    clearTimeout(watchdog); watchdog = 0
    const cancel = cancelInitialization; cancelInitialization = null; cancel?.()
    worker?.terminate(); worker = null; ready = false; pending = false
    fingers.clear(); mouth = null; physics.clearBody()
  }
  function releaseCamera() {
    ++generation; starting = false; stopTracker()
    stream?.getTracks().forEach(track => track.stop()); stream = null
    video.pause(); video.srcObject = null; video.load(); frameSource.release(); physics.stop()
    physics.clear(); fog.clear(); sky.reset(); status.textContent = ''
    gate.hidden = false; startButton.disabled = false; startButton.textContent = '카메라 켜기 ↗'
    root.classList.remove('is-ready'); delete root.dataset.tracking
  }
  function failTracker(error: unknown) {
    console.error('Snow tracking:', error)
    stopTracker(); sky.reset()
    root.dataset.tracking = 'error'
    gate.hidden = false; startButton.disabled = false; startButton.textContent = '다시 연결 ↗'
    status.textContent = '손과 몸 인식을 준비하지 못했어요. 다시 연결해 주세요.'
  }
  function processTracking(result: Extract<TrackingMessage, { type: 'result' }>) {
    const now = performance.now()
    if (now - result.timestamp > 700 || !video.videoWidth || !video.videoHeight) return
    const project = (point: Point) => screenPoint(point, video.videoWidth, video.videoHeight, width, height)
    if (result.body) physics.updateBody(result.body, video.videoWidth, video.videoHeight, now)
    const seen = new Set<string>()
    for (const hand of result.hands) {
      if (!indexExtended(hand.world ?? []) || hand.landmarks.length < 21) { sky.release(hand.id); continue }
      const point = project(hand.landmarks[8]), previous = fingers.get(hand.id)
      const continuous = previous && now - previous.seen < 280
      const palmWidth = Math.hypot(project(hand.landmarks[5]).x - project(hand.landmarks[17]).x,
        project(hand.landmarks[5]).y - project(hand.landmarks[17]).y)
      sky.poke(hand.id, continuous ? previous.point : point, point, now)
      fingers.set(hand.id, { point, drawn: continuous ? previous.drawn : point, seen: now, radius: clamp(palmWidth * .17, 10, 24) })
      seen.add(hand.id)
    }
    for (const id of fingers.keys()) if (!seen.has(id)) { fingers.delete(id); sky.release(id) }
    if (result.face.length >= 292) {
      const top = project(result.face[13]), bottom = project(result.face[14]), left = project(result.face[61]), right = project(result.face[291])
      const mouthWidth = Math.max(1, Math.hypot(right.x - left.x, right.y - left.y))
      const opening = Math.hypot(bottom.x - top.x, bottom.y - top.y) / mouthWidth
      const open = opening > (mouth?.open ? .13 : .20)
      mouth = { point: { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 }, width: mouthWidth,
        open, since: open && mouth?.open ? mouth.since : now, seen: now }
    } else mouth = null
    const handCount = String(fingers.size)
    if (root.dataset.handCount !== handCount) root.dataset.handCount = handCount
  }
  async function initializeTracker(attempt: number) {
    if (worker) return
    const candidate = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' })
    worker = candidate
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog); cancelInitialization = null
        if (error) reject(error); else resolve()
      }
      cancelInitialization = () => finish(new Error('Snow initialization cancelled'))
      watchdog = window.setTimeout(() => finish(new Error('Snow model initialization timed out')), 45000)
      candidate.onerror = event => finish(new Error(event.message))
      candidate.onmessage = (event: MessageEvent<TrackingMessage>) => {
        if (event.data.type === 'ready') finish()
        else if (event.data.type === 'error') finish(new Error(event.data.message))
      }
      candidate.postMessage({ type: 'init', base: new URL(BASE, location.href).href, constrained })
    })
    if (!active || generation !== attempt || worker !== candidate) return
    ready = true; root.dataset.tracking = 'ready'
    candidate.onerror = event => { if (worker === candidate) failTracker(event.message) }
    candidate.onmessage = (event: MessageEvent<TrackingMessage>) => {
      if (worker !== candidate || !active) return
      if (event.data.type === 'result') {
        clearTimeout(watchdog); pending = false
        if (!paused) processTracking(event.data)
      } else if (event.data.type === 'error') failTracker(event.data.message)
    }
    status.textContent = ''; gate.hidden = true; root.classList.add('is-ready')
  }
  async function enableCamera() {
    if (!active || starting || document.hidden) return
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      status.textContent = '카메라를 사용하려면 HTTPS 또는 localhost에서 열어 주세요.'; return
    }
    const attempt = ++generation
    starting = true; startButton.disabled = true; startButton.textContent = '연결 중…'; status.textContent = ''
    let acquired: MediaStream | null = null
    try {
      if (!stream) {
        acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } })
        if (!active || generation !== attempt) { acquired.getTracks().forEach(track => track.stop()); return }
        stream = acquired; video.srcObject = acquired
        acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (stream === acquired) { releaseCamera(); status.textContent = '카메라가 끊겼어요. 다시 켜 주세요.' }
        }, { once: true })
      }
      await video.play()
      if (!active || generation !== attempt) return
      physics.start()
      gate.hidden = true; status.textContent = '구름과 눈을 준비하고 있어요…'
      await initializeTracker(attempt)
    } catch (error) {
      if (generation !== attempt) { acquired?.getTracks().forEach(track => track.stop()); return }
      if (stream && video.readyState >= 2 && !video.paused) failTracker(error)
      else {
        releaseCamera()
        const denied = error instanceof Error && error.name === 'NotAllowedError'
        status.textContent = denied ? '카메라 권한을 허용해 주세요. 인앱에서는 Safari 또는 Chrome으로 열어 주세요.' : '카메라를 연결하지 못했어요. 권한과 다른 앱의 카메라 사용을 확인해 주세요.'
      }
    } finally {
      if (generation === attempt) { starting = false; startButton.disabled = false; startButton.textContent = '카메라 켜기 ↗' }
    }
  }
  async function infer(now: number) {
    const current = worker
    if (!ready || !current || pending || video.readyState < 2 || video.currentTime === videoTime || now - lastInference < (constrained ? 100 : 65)) return
    pending = true; videoTime = video.currentTime; lastInference = now
    let bitmap: TrackingFrame | null = null
    try {
      bitmap = await frameSource.capture(video, constrained ? 480 : 640)
      if (!active || worker !== current) return
      current.postMessage({ type: 'frame', bitmap, timestamp: now }, trackingFrameTransfer(bitmap)); bitmap = null
      watchdog = window.setTimeout(() => { if (worker === current) failTracker('Snow inference timed out') }, 8000)
    } catch (error) { if (worker === current) failTracker(error) }
    finally { if (bitmap) releaseTrackingFrame(bitmap) }
  }
  function draw(now: number) {
    if (!active || paused || document.hidden) return
    frame = requestAnimationFrame(draw)
    if (now - lastFrame < 1000 / 30 - 1) return
    const dt = lastFrame ? Math.min(.06, (now - lastFrame) / 1000) : 1 / 30; lastFrame = now
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalAlpha = 1
    ctx.fillStyle = '#14232e'; ctx.fillRect(0, 0, width, height)
    // Capture one camera frame, then build all graphics on this immutable base.
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const w = video.videoWidth * scale, h = video.videoHeight * scale
      ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1)
      ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h); ctx.restore()
    }
    sky.update(dt, now)
    if (video.readyState >= 2) void infer(now)
    sky.emit(dt, now, (x, y, span, count) => physics.emit(x, y, span, count))
    physics.step(dt, now); fog.step(dt)
    if ((sky.snowing || physics.falling) && mouth?.open && now - mouth.seen < 320) {
      const spread = Math.min(2.2, (now - mouth.since) / 1000)
      const minimum = Math.min(width, height) * .22
      const base = Math.max(minimum, mouth.width * 2.6)
      const radius = Math.min(base * (1 + spread * .5), width * .55, height * .46)
      fog.breathe(mouth.point, radius, dt)
    }
    for (const [id, finger] of fingers) {
      if (now - finger.seen > 280) { fingers.delete(id); sky.release(id); continue }
      const blend = 1 - Math.exp(-dt * 30)
      const tip = { x: finger.drawn.x + (finger.point.x - finger.drawn.x) * blend, y: finger.drawn.y + (finger.point.y - finger.drawn.y) * blend }
      fog.wipe(finger.drawn, tip, finger.radius); finger.drawn = tip
    }
    sky.draw(ctx, now)
    for (const p of physics.flakes) {
      ctx.globalAlpha = 1 - clamp((p.age - 33) / 5)
      // Keep the same antialiased sprite on landing; changing between a
      // crystal and a solid circle each contact frame caused visible flicker.
      const size = p.radius * 3.1
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle)
      ctx.drawImage(crystal, -size / 2, -size / 2, size, size); ctx.restore()
    }
    ctx.globalAlpha = 1
    output.setTransform(1, 0, 0, 1, 0, 0); output.globalAlpha = 1
    output.globalCompositeOperation = 'copy'; output.drawImage(scene, 0, 0)
    output.globalCompositeOperation = 'source-over'; output.setTransform(ratio, 0, 0, ratio, 0, 0)
    fog.draw(output, scene)
    const flakeCount = String(physics.flakes.length)
    if (root.dataset.snowflakes !== flakeCount) root.dataset.snowflakes = flakeCount
  }
  function resume() {
    if (!active || paused || document.hidden) return
    cancelAnimationFrame(frame); lastFrame = 0; videoTime = -1; frame = requestAnimationFrame(draw)
  }
  startButton.addEventListener('click', () => { void enableCamera() })
  window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (!active) return
    if (document.hidden) { cancelAnimationFrame(frame); releaseCamera() }
    else resume()
  })
  window.addEventListener('pagehide', () => { if (active) { cancelAnimationFrame(frame); releaseCamera() } })
  window.addEventListener('pageshow', resume)
  return {
    start() {
      if (active) return
      active = true; paused = false; resize(); physics.clear(); sky.reset(); fog.clear()
      status.textContent = ''; gate.hidden = false; resume()
    },
    stop() {
      if (!active) return
      active = false; paused = false; cancelAnimationFrame(frame); releaseCamera()
      physics.clear(); sky.reset(); fog.clear(); output.setTransform(1, 0, 0, 1, 0, 0); output.clearRect(0, 0, canvas.width, canvas.height); status.textContent = ''
    },
    setPaused(value: boolean) {
      paused = value
      if (value) { cancelAnimationFrame(frame); video.pause() }
      else if (active) {
        if (stream) void video.play().then(resume).catch(() => { releaseCamera(); resume() })
        else resume()
      }
    },
    captureFrame() {
      if (capture.width !== canvas.width) capture.width = canvas.width
      if (capture.height !== canvas.height) capture.height = canvas.height
      captureContext.clearRect(0, 0, capture.width, capture.height)
      captureContext.drawImage(canvas, 0, 0)
      return capture
    },
  }
}
