import './lemonade.css'
import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
import { clamp, coverPoint, distance, entersCup, isClosedFist } from './lemonade-physics'
import type { Point } from './lemonade-physics'

type Lemon = Point & { homeX: number; homeY: number; phase: number; size: number; juice: number; state: 'floating' | 'held' | 'spent'; vy: number; angle: number; squash: number; emission: number }
type Drop = Point & { vx: number; vy: number; amount: number }
type Spark = Point & { vx: number; vy: number; life: number }
type Hand = Point & { seen: number; closed: boolean }
type Config = { image: string; lemonCount: number; juicePerLemon: number; cupCapacity: number }
const BASE = import.meta.env.BASE_URL
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const defaults: Config = { image: 'lemon.svg', lemonCount: 6, juicePerLemon: 100, cupCapacity: 300 }
const userAgent = navigator.userAgent
const isInAppBrowser = /(KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\()/i.test(userAgent)
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const isConstrainedDevice = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
const frameInterval = 1000 / (isConstrainedDevice ? 24 : 30)
const detectionInterval = isConstrainedDevice ? 90 : 65
const faceDetectionInterval = isConstrainedDevice ? 220 : 160

export function createLemonade(root: HTMLElement) {
  root.innerHTML = `
    <video class="lemonade__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="lemonade__canvas" aria-label="카메라 위에 떠 있는 레몬과 투명한 컵"></canvas>
    <div class="lemonade__shade" aria-hidden="true"></div>
    <header class="lemonade__header">
      <p>HAND INTERACTION / 07</p><h2>Lemonade<span> Freshly squeezed, by you.</span></h2>
    </header>
    <div class="lemonade__readout"><span class="lemonade__live">CAMERA OFF</span><span class="lemonade__volume">0 / 300 ml</span></div>
    <div class="lemonade__gate">
      <span class="lemonade__gate-icon" aria-hidden="true">✳</span>
      <p class="lemonade__eyebrow">A LITTLE SUNSHINE IN YOUR HANDS</p>
      <h3>오늘의 레몬에이드,<br>직접 만들어 볼까요?</h3>
      <p class="lemonade__gate-copy">왼손으로 레몬을 짜고<br>오른손으로 컵을 움직여 받아 주세요.</p>
      <button class="lemonade__start" type="button">카메라 켜기 <span>↗</span></button>
      <small>카메라 화면은 기기 안에서만 처리됩니다.</small>
    </div>
    <div class="lemonade__bottom">
      <div class="lemonade__hand lemonade__hand--left"><i></i><span>LEFT HAND<small>주먹을 쥐어 레몬 짜기</small></span></div>
      <div class="lemonade__capture-space" aria-hidden="true"></div>
      <div class="lemonade__hand lemonade__hand--right"><i></i><span>RIGHT HAND<small>손바닥으로 컵 움직이기</small></span></div>
    </div>
    <div class="lemonade__tools"><button class="lemonade__swap" type="button" aria-label="왼손과 오른손 인식 바꾸기" title="손이 반대로 인식되면 눌러 주세요">손 좌우 전환</button><button class="lemonade__reset" type="button">새로 만들기 ↻</button></div>
    <p class="lemonade__status" role="status" aria-live="polite"></p>
`
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const video = q<HTMLVideoElement>('.lemonade__camera')
  const canvas = q<HTMLCanvasElement>('.lemonade__canvas')
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  const input = document.createElement('canvas')
  const inputCtx = input.getContext('2d')!
  const gate = q<HTMLDivElement>('.lemonade__gate')
  const startButton = q<HTMLButtonElement>('.lemonade__start')
  const status = q<HTMLParagraphElement>('.lemonade__status')
  const live = q<HTMLSpanElement>('.lemonade__live')
  const volume = q<HTMLSpanElement>('.lemonade__volume')
  const leftIndicator = q<HTMLDivElement>('.lemonade__hand--left')
  const rightIndicator = q<HTMLDivElement>('.lemonade__hand--right')
  const picture = new Image()
  let config = { ...defaults }
  let assetLoaded = false
  let active = false
  let ready = false
  let starting = false
  let generation = 0
  let stream: MediaStream | null = null
  let detector: HandLandmarker | null = null
  let detectorPromise: Promise<HandLandmarker> | null = null
  let faceDetector: FaceLandmarker | null = null
  let faceDetectorPromise: Promise<FaceLandmarker> | null = null
  let frame = 0
  let lastTime = 0
  let lastDetection = 0
  let lastFaceDetection = 0
  let lastVideoTime = -1
  let width = 1
  let height = 1
  let pixelRatio = 1
  let lemons: Lemon[] = []
  let drops: Drop[] = []
  let sparks: Spark[] = []
  let held: Lemon | null = null
  let left: Hand | null = null
  let right: Hand | null = null
  let swapped = false
  let cup = { x: 0, y: 0 }
  let cupWidth = 130
  let cupHeight = 180
  let fill = 0
  let visualFill = 0
  let strawVisible = false
  let mouth: (Point & { seen: number }) | null = null
  let drinking = false
  let statusTimer = 0

  function say(message: string, persistent = false) {
    clearTimeout(statusTimer)
    status.textContent = message
    if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '' }, 5000)
  }

  async function loadAssets() {
    if (assetLoaded) return
    try {
      const response = await fetch(`${BASE}lemonade/config.json`)
      if (!response.ok) throw new Error('config')
      const data = await response.json()
      config = {
        image: typeof data.image === 'string' ? data.image : defaults.image,
        lemonCount: clamp(Number(data.lemonCount) || 6, 1, 12),
        juicePerLemon: clamp(Number(data.juicePerLemon) || 100, 10, 500),
        cupCapacity: clamp(Number(data.cupCapacity) || 300, 50, 3000),
      }
    } catch { config = { ...defaults } }
    // Only same-origin images: exported canvases must remain origin-clean.
    const url = new URL(config.image, new URL(`${BASE}lemonade/`, location.href))
    picture.src = url.origin === location.origin ? url.href : `${BASE}lemonade/lemon.svg`
    try { await picture.decode() } catch { picture.src = `${BASE}lemonade/lemon.svg`; await picture.decode().catch(() => {}) }
    assetLoaded = true
    if (active) reset()
  }

  async function loadDetector() {
    if (detector) return detector
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
        const options = { runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55 }
        try {
          return await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'GPU' } })
        } catch {
          return await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'CPU' } })
        }
      })().then((value) => { detector = value; return value }).catch((error) => { detectorPromise = null; throw error })
    }
    return detectorPromise
  }

  async function loadFaceDetector() {
    if (faceDetector) return faceDetector
    if (!faceDetectorPromise) {
      faceDetectorPromise = (async () => {
        const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
        const options = { runningMode: 'VIDEO' as const, numFaces: 1, minFaceDetectionConfidence: .55, minFacePresenceConfidence: .55, minTrackingConfidence: .55 }
        try {
          return await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' } })
        } catch {
          return FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' } })
        }
      })().then((value) => { faceDetector = value; return value }).catch((error) => { faceDetectorPromise = null; throw error })
    }
    return faceDetectorPromise
  }

  async function enableCamera() {
    if (starting || ready || !active) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say(isInAppBrowser
        ? '인앱 브라우저에서는 카메라가 제한될 수 있어요. 이 링크를 Safari 또는 Chrome에서 열어 주세요.'
        : '카메라를 사용하려면 HTTPS 또는 localhost로 접속해 주세요.', true)
      return
    }
    const attempt = ++generation
    starting = true
    startButton.disabled = true
    startButton.textContent = '카메라 연결 중…'
    let acquired: MediaStream | null = null
    let phase = 'camera'
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } })
      if (!active || generation !== attempt) { acquired.getTracks().forEach((t) => t.stop()); return }
      stream = acquired
      video.srcObject = acquired
      await video.play()
      phase = 'tracking'
      startButton.textContent = '손 트래킹 준비 중…'
      await loadDetector()
      if (!active || generation !== attempt) { acquired.getTracks().forEach((t) => t.stop()); return }
      ready = true
      gate.hidden = true
      live.textContent = 'LIVE'
      live.classList.add('is-live')
      root.classList.add('is-ready')
      lastVideoTime = -1
      say('레몬 가까이에서 왼손 주먹을 쥐어 보세요.')
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream === acquired && ready) { releaseCamera(); say('카메라 연결이 끊겼어요. 다시 켜 주세요.', true) }
      }, { once: true })
    } catch (error) {
      acquired?.getTracks().forEach((t) => t.stop())
      if (generation !== attempt) return
      stream = null
      video.srcObject = null
      const name = error instanceof Error ? error.name : ''
      say(phase === 'tracking'
        ? '손 트래킹을 불러오지 못했어요. 새로고침하거나 다시 시도해 주세요.'
        : isInAppBrowser && name === 'NotAllowedError'
          ? '인앱 브라우저가 카메라 권한을 막았어요. 이 링크를 Safari 또는 Chrome에서 열어 주세요.'
          : name === 'NotAllowedError'
            ? '카메라 권한을 허용한 뒤 다시 눌러 주세요.'
            : name === 'NotFoundError'
              ? '카메라를 찾지 못했어요. 연결 상태를 확인해 주세요.'
              : '카메라를 시작하지 못했어요. 다른 앱에서 사용 중인지 확인해 주세요.', true)
    } finally {
      if (generation === attempt) {
        starting = false
        startButton.disabled = false
        startButton.innerHTML = '카메라 켜기 <span>↗</span>'
      }
    }
  }

  function makeLemon(index: number): Lemon {
    const columns = width < 600 ? 3 : 4
    const homeX = ((index % columns) + 0.5) / columns
    const homeY = 0.30 + Math.floor(index / columns) * 0.18
    return { x: width * homeX, y: height * homeY, homeX, homeY, phase: rand(0, Math.PI * 2), size: rand(0.9, 1.1), juice: config.juicePerLemon, state: 'floating', vy: 0, angle: rand(-0.4, 0.4), squash: 1, emission: 0 }
  }

  function reset() {
    lemons = Array.from({ length: Math.floor(config.lemonCount) }, (_, i) => makeLemon(i))
    drops = []; sparks = []; held = null; fill = 0; visualFill = 0; strawVisible = false; mouth = null; drinking = false
    root.classList.remove('is-drinking')
    volume.textContent = `0 / ${config.cupCapacity} ml`
  }

  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect()
    const oldW = width; const oldH = height
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
    pixelRatio = Math.min(devicePixelRatio || 1, 2, 1600 / Math.max(width, height))
    const cw = Math.round(width * pixelRatio / 2) * 2
    const ch = Math.round(height * pixelRatio / 2) * 2
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    cupWidth = clamp(width * 0.25, 98, 150)
    cupHeight = Math.min(cupWidth * 1.35, height * 0.3)
    cup.x = width / 2; cup.y = height - cupHeight - (height < 500 ? 85 : 145)
    for (const lemon of lemons) { lemon.x *= width / oldW; lemon.y *= height / oldH }
    drops = []; left = null; right = null
  }

  function trackHands(now: number) {
    if (!ready || !detector || video.readyState < 2 || now - lastDetection < detectionInterval || lastVideoTime === video.currentTime) return
    lastDetection = now; lastVideoTime = video.currentTime
    const iw = isConstrainedDevice ? 512 : 640; const ih = Math.round(iw * video.videoHeight / video.videoWidth)
    if (!ih) return
    if (input.width !== iw || input.height !== ih) { input.width = iw; input.height = ih }
    // The model's handedness assumes a mirrored selfie image. Mirror inference and display identically.
    inputCtx.setTransform(-1, 0, 0, 1, iw, 0)
    inputCtx.drawImage(video, 0, 0, iw, ih)
    try {
      const result = detector.detectForVideo(input, now)
      result.landmarks.forEach((landmarks, index) => {
        const label = result.handedness[index]?.[0]
        if (!label || label.score < 0.6) return
        const isLeft = (label.categoryName === 'Left') !== swapped
        const center = [0, 5, 9, 13, 17].reduce((p, i) => ({ x: p.x + landmarks[i].x / 5, y: p.y + landmarks[i].y / 5 }), { x: 0, y: 0 })
        const point = coverPoint(center, iw, ih, width, height)
        const previous = isLeft ? left : right
        const hand = { ...point, seen: now, closed: isClosedFist(result.worldLandmarks[index] ?? landmarks, previous?.closed) }
        if (isLeft) left = hand
        else right = hand
      })
      trackMouth(now)
    } catch {
      releaseCamera()
      detector?.close(); detector = null; detectorPromise = null
      say('손 트래킹이 중단됐어요. 카메라를 다시 켜 주세요.', true)
    }
  }

  function trackMouth(now: number) {
    if (!strawVisible || !faceDetector || now - lastFaceDetection < faceDetectionInterval) return
    lastFaceDetection = now
    try {
      const face = faceDetector.detectForVideo(input, now).faceLandmarks[0]
      if (!face) return
      // 13 and 14 sit at the centre of the upper and lower inner lip.
      const point = coverPoint({ x: (face[13].x + face[14].x) / 2, y: (face[13].y + face[14].y) / 2 }, input.width, input.height, width, height)
      mouth = mouth
        ? { x: mouth.x + (point.x - mouth.x) * .72, y: mouth.y + (point.y - mouth.y) * .72, seen: now }
        : { ...point, seen: now }
    } catch {
      mouth = null
    }
  }

  function strawPosition() {
    return { x: cup.x + cupWidth * .15, top: cup.y - cupHeight * .44, bottom: cup.y + cupHeight * .28 }
  }

  function update(dt: number, now: number) {
    const t = now / 1000
    if (left && now - left.seen > 220) left = null
    if (right && now - right.seen > 300) right = null
    if (mouth && now - mouth.seen > 500) mouth = null
    leftIndicator.classList.toggle('is-tracked', !!left)
    rightIndicator.classList.toggle('is-tracked', !!right)
    leftIndicator.classList.toggle('is-squeezing', !!held)
    const oldCup = { ...cup }
    const targetX = right ? right.x : width / 2
    const targetY = right ? right.y - cupHeight * 0.5 : height - cupHeight - (height < 500 ? 85 : 145)
    const ease = 1 - Math.exp(-12 * dt)
    cup.x += (clamp(targetX, cupWidth / 2 + 8, width - cupWidth / 2 - 8) - cup.x) * ease
    cup.y += (clamp(targetY, 35, height - cupHeight - 20) - cup.y) * ease
    if (held && (!left || !left.closed)) {
      held.state = 'floating'; held.homeX = clamp(held.x / width, 0.12, 0.88); held.homeY = clamp(held.y / height, 0.25, 0.65); held = null
    }
    if (left?.closed && !held) {
      let nearest = Infinity
      for (const lemon of lemons) {
        const d = distance(left, lemon)
        if (lemon.state === 'floating' && d < lemonSize(lemon) * 0.7 + 25 && d < nearest) { held = lemon; nearest = d }
      }
      if (held) held.state = 'held'
    }
    for (let i = 0; i < lemons.length; i++) {
      const lemon = lemons[i]
      if (lemon.state === 'held' && left) {
        lemon.x += (left.x - lemon.x) * (1 - Math.exp(-24 * dt))
        lemon.y += (left.y - lemon.y) * (1 - Math.exp(-24 * dt))
        lemon.angle *= 1 - ease
        lemon.squash = 0.55 + Math.sin(t * 19) * 0.13
        lemon.emission += dt
        while (lemon.emission >= 0.035 && lemon.juice > 0) {
          const amount = Math.min(lemon.juice, config.juicePerLemon / 100)
          lemon.juice = Math.max(0, lemon.juice - amount)
          lemon.emission -= 0.035
          drops.push({ x: lemon.x + rand(-12, 12), y: lemon.y + lemonSize(lemon) * 0.23, vx: rand(-22, 22), vy: rand(100, 150), amount })
        }
        if (lemon.juice <= 0.0001) { lemon.state = 'spent'; lemon.squash = 0.33; lemon.vy = 50; held = null }
      } else if (lemon.state === 'spent') {
        lemon.vy += 650 * dt; lemon.y += lemon.vy * dt; lemon.angle += dt * 1.4
        if (lemon.y > height + 120) lemons[i] = makeLemon(i)
      } else {
        const drift = Math.min(24, width * 0.035)
        lemon.x += (lemon.homeX * width + Math.sin(t * 0.45 + lemon.phase) * drift - lemon.x) * ease
        lemon.y += (lemon.homeY * height + Math.cos(t * 0.7 + lemon.phase) * 17 - lemon.y) * ease
        lemon.angle = Math.sin(t * 0.6 + lemon.phase) * 0.24
        lemon.squash += (1 - lemon.squash) * ease
        lemon.emission = 0
      }
    }
    drops = drops.filter((drop) => {
      const before = { x: drop.x, y: drop.y }
      drop.vy += 700 * dt; drop.x += drop.vx * dt; drop.y += drop.vy * dt
      if (entersCup(before, drop, oldCup, cup, cupWidth * 0.43)) {
        const wasFull = fill >= config.cupCapacity
        fill = Math.min(config.cupCapacity, fill + drop.amount)
        if (!wasFull && fill >= config.cupCapacity) {
          strawVisible = true
          void loadFaceDetector().catch(() => say('빨대의 입 위치를 찾지 못했어요. 조명을 밝게 하고 다시 시도해 주세요.'))
          say('레몬에이드 완성! 컵을 입가로 가져가 빨대를 대 보세요.')
        }
        for (let i = 0; i < 3; i++) sparks.push({ x: drop.x, y: cup.y + cupHeight * (0.94 - visualFill * 0.83), vx: rand(-65, 65), vy: rand(-100, -35), life: rand(0.2, 0.45) })
        return false
      }
      return drop.y < height + 20
    })
    if (strawVisible && fill > 0 && mouth) {
      const straw = strawPosition()
      drinking = Math.hypot(mouth.x - straw.x, mouth.y - straw.top) < clamp(cupWidth * .36, 38, 62)
      if (drinking) fill = Math.max(0, fill - 68 * dt)
    } else drinking = false
    root.classList.toggle('is-drinking', drinking)
    if (strawVisible && fill <= .01 && drinking) { drinking = false; root.classList.remove('is-drinking'); say('맛있게 다 마셨어요! 새로 만들기로 다시 채워 보세요.') }
    sparks = sparks.filter((s) => { s.x += s.vx * dt; s.vy += 500 * dt; s.y += s.vy * dt; s.life -= dt; return s.life > 0 }).slice(-120)
    visualFill += (fill / config.cupCapacity - visualFill) * (1 - Math.exp(-5 * dt))
    const label = `${Math.round(fill)} / ${config.cupCapacity} ml`
    if (volume.textContent !== label) volume.textContent = label
  }

  function lemonSize(lemon: Lemon) { return clamp(width * 0.17, 85, 142) * lemon.size }

  function drawSlice(x: number, y: number, r: number, angle: number) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
    ctx.fillStyle = '#f5ca2b'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff8c1'; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill()
    for (let i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * 0.74, i * Math.PI / 4 + 0.07, (i + 1) * Math.PI / 4 - 0.07); ctx.closePath(); ctx.fillStyle = i % 2 ? '#ffe477' : '#f8d54f'; ctx.fill()
    }
    ctx.fillStyle = '#fff6cf'; ctx.beginPath(); ctx.arc(0, 0, r * 0.11, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  }

  function glassPath() {
    const w = cupWidth; const h = cupHeight
    ctx.beginPath(); ctx.moveTo(-w * 0.48, 0); ctx.lineTo(-w * 0.36, h - 12)
    ctx.quadraticCurveTo(-w * 0.35, h, -w * 0.25, h); ctx.lineTo(w * 0.25, h)
    ctx.quadraticCurveTo(w * 0.35, h, w * 0.36, h - 12); ctx.lineTo(w * 0.48, 0); ctx.closePath()
  }

  function drawCup(time: number) {
    ctx.save(); ctx.translate(cup.x, cup.y)
    const w = cupWidth; const h = cupHeight
    const surface = h * (0.94 - visualFill * 0.83)
    ctx.fillStyle = 'rgba(240,252,255,0.09)'; glassPath(); ctx.fill()
    ctx.save(); glassPath(); ctx.clip()
    if (visualFill > 0.001) {
      const liquid = ctx.createLinearGradient(0, surface, 0, h)
      liquid.addColorStop(0, 'rgba(255,231,95,.74)'); liquid.addColorStop(1, 'rgba(239,184,25,.90)')
      ctx.fillStyle = liquid; ctx.beginPath(); ctx.moveTo(-w, surface)
      for (let x = -w; x <= w; x += 5) ctx.lineTo(x, surface + Math.sin(x * 0.07 + time * 2.8) * 2.3)
      ctx.lineTo(w, h + 10); ctx.lineTo(-w, h + 10); ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,210,.4)'
      ctx.beginPath(); ctx.ellipse(0, surface, w * 0.43, 5, 0, 0, Math.PI * 2); ctx.fill()
    }
    drawSlice(w * 0.15, Math.min(h - 30, surface + h * 0.22), w * 0.23, time * 0.11)
    for (let i = 0; i < 5; i++) {
      const size = w * (0.22 + (i % 2) * 0.025)
      const restingY = h - size * 0.6 - 8 - Math.floor(i / 2) * size * 0.66
      const floatingY = surface + (i % 3) * size * 0.47 + Math.sin(time * 1.8 + i * 2) * 3
      const y = Math.min(restingY, floatingY)
      const x = (i % 2 ? 1 : -1) * w * 0.19 + Math.sin(time + i) * visualFill * 3
      ctx.save(); ctx.translate(x, y); ctx.rotate((i - 2) * 0.23 + Math.sin(time * 0.8 + i) * visualFill * 0.12)
      const ice = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2)
      ice.addColorStop(0, 'rgba(255,255,255,.8)'); ice.addColorStop(0.48, 'rgba(224,246,255,.21)'); ice.addColorStop(1, 'rgba(240,254,255,.57)')
      ctx.fillStyle = ice; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, 6); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(-size * 0.28, size * 0.18); ctx.lineTo(-size * 0.28, -size * 0.23); ctx.lineTo(size * 0.14, -size * 0.23); ctx.strokeStyle = 'rgba(255,255,255,.62)'; ctx.stroke(); ctx.restore()
    }
    ctx.restore()
    const glass = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
    glass.addColorStop(0, 'rgba(255,255,255,.6)'); glass.addColorStop(0.18, 'rgba(255,255,255,.03)'); glass.addColorStop(0.78, 'rgba(255,255,255,.02)'); glass.addColorStop(1, 'rgba(255,255,255,.46)')
    glassPath(); ctx.fillStyle = glass; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.78)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.48, 7, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-w * 0.37, 17); ctx.lineTo(-w * 0.28, h - 22); ctx.strokeStyle = 'rgba(255,255,255,.58)'; ctx.lineWidth = 3; ctx.stroke()
    ctx.beginPath(); ctx.ellipse(0, h - 5, w * 0.32, 4, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke()
    drawSlice(w * 0.37, 10, w * 0.19, -0.5)
    ctx.restore()
  }

  function drawStraw(time: number) {
    if (!strawVisible) return
    const straw = strawPosition()
    const length = straw.bottom - straw.top
    ctx.save()
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(8, cupWidth * .065); ctx.strokeStyle = '#fff3d7'
    ctx.beginPath(); ctx.moveTo(straw.x, straw.bottom); ctx.lineTo(straw.x, straw.top); ctx.stroke()
    ctx.save(); ctx.beginPath(); ctx.moveTo(straw.x, straw.bottom); ctx.lineTo(straw.x, straw.top); ctx.clip()
    ctx.strokeStyle = '#ef6e58'; ctx.lineWidth = Math.max(2.4, cupWidth * .018)
    for (let y = straw.top - 32; y < straw.bottom + 32; y += 18) {
      ctx.beginPath(); ctx.moveTo(straw.x - 13, y); ctx.lineTo(straw.x + 13, y + 12); ctx.stroke()
    }
    if (drinking) {
      ctx.strokeStyle = 'rgba(255,218,73,.88)'; ctx.lineWidth = Math.max(2, cupWidth * .016)
      for (let i = 0; i < 3; i++) {
        const y = straw.bottom - ((time * 175 + i * length / 3) % length)
        ctx.beginPath(); ctx.moveTo(straw.x, Math.min(straw.bottom, y + 12)); ctx.lineTo(straw.x, Math.max(straw.top, y - 8)); ctx.stroke()
      }
    }
    ctx.restore()
    // Continue the visible liquid flow beyond the straw, toward the detected
    // mouth, so the suction reads as drinking rather than a straw-only effect.
    if (drinking && mouth) {
      const dx = mouth.x - straw.x; const dy = mouth.y - straw.top
      const distance = Math.max(1, Math.hypot(dx, dy)); const ux = dx / distance; const uy = dy / distance
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2.2, cupWidth * .018)
      ctx.strokeStyle = 'rgba(255,224,86,.8)'; ctx.shadowColor = 'rgba(255,224,86,.62)'; ctx.shadowBlur = 8
      ctx.setLineDash([8, 12]); ctx.lineDashOffset = -time * 145
      ctx.beginPath(); ctx.moveTo(straw.x, straw.top); ctx.lineTo(mouth.x, mouth.y); ctx.stroke(); ctx.setLineDash([])
      for (let i = 0; i < 3; i++) {
        const progress = (time * .92 + i / 3) % 1
        const x = straw.x + dx * progress; const y = straw.top + dy * progress
        ctx.fillStyle = 'rgba(255,230,101,.96)'; ctx.beginPath(); ctx.ellipse(x, y, 3.6, 5.6, Math.atan2(dy, dx) + Math.PI / 2, 0, Math.PI * 2); ctx.fill()
      }
      // A small bright endpoint makes it clear that the flow reaches the mouth.
      ctx.shadowBlur = 12; ctx.fillStyle = 'rgba(255,235,138,.9)'; ctx.beginPath(); ctx.arc(mouth.x - ux * 2, mouth.y - uy * 2, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.restore()
    }
    ctx.restore()
  }

  function draw(now: number) {
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    ctx.fillStyle = '#343c31'; ctx.fillRect(0, 0, width, height)
    if (ready && video.readyState >= 2) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const vw = video.videoWidth * scale; const vh = video.videoHeight * scale
      ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(video, (width - vw) / 2, (height - vh) / 2, vw, vh); ctx.restore()
    } else {
      const bg = ctx.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.7)
      bg.addColorStop(0, '#65725a'); bg.addColorStop(1, '#29392f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height)
    }
    for (const lemon of lemons) {
      const size = lemonSize(lemon)
      ctx.save(); ctx.translate(lemon.x, lemon.y); ctx.rotate(lemon.angle); ctx.scale(1 + (1 - lemon.squash) * 0.36, lemon.squash)
      ctx.shadowColor = 'rgba(31,30,4,.28)'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 12
      if (picture.complete && picture.naturalWidth) {
        const aspect = picture.naturalHeight / picture.naturalWidth
        const dw = aspect > 1 ? size / aspect : size; const dh = aspect > 1 ? size : size * aspect
        ctx.drawImage(picture, -dw / 2, -dh / 2, dw, dh)
      } else {
        ctx.fillStyle = '#ffe34b'; ctx.beginPath(); ctx.ellipse(0, 0, size / 2, size * 0.32, 0, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
      if (lemon.state === 'held') {
        ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.beginPath(); ctx.roundRect(lemon.x - 22, lemon.y - size * 0.48, 44, 3, 2); ctx.fill()
        ctx.fillStyle = '#fff4a2'; ctx.beginPath(); ctx.roundRect(lemon.x - 22, lemon.y - size * 0.48, Math.max(0.1, 44 * lemon.juice / config.juicePerLemon), 3, 2); ctx.fill()
      }
    }
    for (const drop of drops) {
      ctx.fillStyle = '#ffdf4e'; ctx.beginPath(); ctx.ellipse(drop.x, drop.y, 2.5, 5.5, 0, 0, Math.PI * 2); ctx.fill()
    }
    drawStraw(now / 1000)
    drawCup(now / 1000)
    for (const s of sparks) { ctx.globalAlpha = Math.min(1, s.life * 4); ctx.fillStyle = '#ffe98c'; ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill() }
    ctx.globalAlpha = 1
  }

  function animate(now: number) {
    if (!active) return
    frame = requestAnimationFrame(animate)
    if (now - lastTime < frameInterval) return
    const dt = Math.min((now - (lastTime || now)) / 1000, 0.05); lastTime = now
    trackHands(now); update(dt, now); draw(now)
  }

  startButton.addEventListener('click', () => { void enableCamera() })
  q('.lemonade__reset').addEventListener('click', reset)
  q('.lemonade__swap').addEventListener('click', () => { swapped = !swapped; left = null; right = null; say('손 인식의 좌우를 바꿨어요.') })
  function releaseCamera() {
    ++generation; starting = false; ready = false
    stream?.getTracks().forEach((track) => track.stop()); stream = null
    video.pause(); video.srcObject = null; left = null; right = null; mouth = null; drinking = false; root.classList.remove('is-drinking')
    faceDetector?.close(); faceDetector = null; faceDetectorPromise = null
    gate.hidden = false; startButton.disabled = false
    startButton.innerHTML = '카메라 켜기 <span>↗</span>'
    live.textContent = 'CAMERA OFF'; live.classList.remove('is-live'); root.classList.remove('is-ready')
  }
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) { releaseCamera(); cancelAnimationFrame(frame); lastTime = 0 }
    else if (active) { cancelAnimationFrame(frame); frame = requestAnimationFrame(animate) }
  })
  window.addEventListener('pagehide', () => { if (active) { releaseCamera(); cancelAnimationFrame(frame) } })
  window.addEventListener('pageshow', () => { if (active) { cancelAnimationFrame(frame); lastTime = 0; frame = requestAnimationFrame(animate) } })

  return {
    captureFrame() { return canvas },
    start() {
      if (active) return
      active = true; resize(); if (!lemons.length) reset()
      void loadAssets(); lastTime = 0; frame = requestAnimationFrame(animate)
    },
    stop() {
      if (!active) return
      active = false; releaseCamera(); cancelAnimationFrame(frame); clearTimeout(statusTimer)
    },
  }
}
