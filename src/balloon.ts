import './balloon.css'
import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
import { clamp, coverPoint } from './lemonade-physics'

type Point = { x: number; y: number }
type Pinch = Point & { id: number; index: Point; pinching: boolean; seen: number }
type Mouth = Point & { rounded: boolean; seen: number }
type Balloon = {
  id: number; x: number; y: number; vx: number; vy: number; radius: number; color: string
  stringLength: number; sway: number; heldBy: number | null; sprite: HTMLCanvasElement; spritePixelRatio: number; spritePadding: number
  displayScale: number; blow: { x: number; y: number; phase: number } | null
}
type Fragment = Point & { vx: number; vy: number; angle: number; spin: number; size: number; color: string; life: number }

const BASE = import.meta.env.BASE_URL
const FACE_MODEL_URL = `${BASE}mediapipe/face_landmarker.task`
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const palette = ['#ff5b72', '#ff9a49', '#ffd45b', '#8dde72', '#55d8cc', '#58aaff', '#897bff', '#c878ef', '#f36daa']
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const constrained = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
const frameInterval = 1000 / (constrained ? 24 : 30)
const detectionInterval = constrained ? 125 : 83
const faceDetectionInterval = constrained ? 250 : 180

export function createBalloon(root: HTMLElement) {
  root.innerHTML = `
    <video class="balloon__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="balloon__canvas" aria-label="카메라 위로 떠오르는 풍선"></canvas>
    <header class="balloon__header"><p>HAND INTERACTION / 09</p><h2>Balloon</h2><span>Hold the string. Pop the color.</span></header>
    <div class="balloon__readout"><span class="balloon__live">CAMERA OFF</span><span class="balloon__count">0 BALLOONS</span></div>
    <div class="balloon__gate">
      <div class="balloon__symbol" aria-hidden="true">◌</div>
      <p class="balloon__eyebrow">FLOAT INTO THE MOMENT</p>
      <h3>풍선을 잡아 볼까요?</h3>
      <p>검지로 풍선을 터뜨리고,<br>엄지와 검지로 끈을 집어 보세요.</p>
      <button class="balloon__start" type="button">카메라 켜기 <span>↗</span></button>
      <small>카메라 화면은 기기 안에서만 처리됩니다.</small>
    </div>
    <p class="balloon__hint">검지: 풍선 터뜨리기 · 엄지 + 검지: 끈 잡기</p>
    <button class="balloon__reset" type="button">새 풍선 ↻</button>
    <p class="balloon__status" role="status" aria-live="polite"></p>
  `
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const video = q<HTMLVideoElement>('.balloon__camera')
  const canvas = q<HTMLCanvasElement>('.balloon__canvas')
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  const input = document.createElement('canvas')
  const inputCtx = input.getContext('2d')!
  const gate = q<HTMLDivElement>('.balloon__gate')
  const startButton = q<HTMLButtonElement>('.balloon__start')
  const status = q<HTMLParagraphElement>('.balloon__status')
  const live = q<HTMLSpanElement>('.balloon__live')
  const count = q<HTMLSpanElement>('.balloon__count')

  let active = false
  let paused = false
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
  let nextId = 1
  let balloons: Balloon[] = []
  let fragments: Fragment[] = []
  let pinches = new Map<number, Pinch>()
  let mouth: Mouth | null = null
  let spawnClock = 0
  let statusTimer = 0
  let renderedCount = ''
  let adaptiveFrameInterval = frameInterval
  let lastAnimationCallback = 0
  let throttledUntil = 0

  function say(message: string, persistent = false) {
    clearTimeout(statusTimer); status.textContent = message
    if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '' }, 4000)
  }

  function updateCount() {
    const label = `${balloons.length} BALLOONS`
    if (label !== renderedCount) { renderedCount = label; count.textContent = label }
  }

  // The balloon body has no frame-dependent geometry. Rendering it once keeps
  // the same gradients, highlight, shadow, and knot while removing repeated
  // path and gradient creation from every animation frame.
  function createBalloonSprite(color: string, radius: number) {
    // Includes the original soft drop shadow, so cache boundaries never clip it.
    const padding = radius * .6
    const logicalWidth = radius * 2 + padding * 2
    const logicalHeight = radius * 2.12 + padding * 2
    const ratio = pixelRatio
    const sprite = document.createElement('canvas')
    sprite.width = Math.max(2, Math.ceil(logicalWidth * ratio)); sprite.height = Math.max(2, Math.ceil(logicalHeight * ratio))
    const spriteCtx = sprite.getContext('2d')!
    spriteCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    spriteCtx.translate(logicalWidth / 2, padding + radius)
    spriteCtx.shadowColor = 'rgba(8,18,32,.38)'; spriteCtx.shadowBlur = radius * .32; spriteCtx.shadowOffsetY = radius * .16
    const fill = spriteCtx.createRadialGradient(-radius * .3, -radius * .38, radius * .03, 0, 0, radius * 1.2)
    fill.addColorStop(0, '#ffffff'); fill.addColorStop(.09, color); fill.addColorStop(.68, color); fill.addColorStop(1, 'rgba(0,0,0,.24)')
    spriteCtx.fillStyle = fill; spriteCtx.beginPath(); spriteCtx.moveTo(0, -radius)
    spriteCtx.bezierCurveTo(radius * .8, -radius * .96, radius * 1.02, -.14 * radius, radius * .62, radius * .55)
    spriteCtx.quadraticCurveTo(radius * .25, radius * .9, 0, radius); spriteCtx.quadraticCurveTo(-radius * .25, radius * .9, -radius * .62, radius * .55)
    spriteCtx.bezierCurveTo(-radius * 1.02, -.14 * radius, -radius * .8, -radius * .96, 0, -radius); spriteCtx.fill()
    spriteCtx.shadowColor = 'transparent'; spriteCtx.globalAlpha = .55; spriteCtx.fillStyle = '#fff'; spriteCtx.beginPath(); spriteCtx.ellipse(-radius * .34, -radius * .39, radius * .13, radius * .28, -.48, 0, Math.PI * 2); spriteCtx.fill()
    spriteCtx.globalAlpha = 1; spriteCtx.fillStyle = color; spriteCtx.beginPath(); spriteCtx.moveTo(-radius * .14, radius * .84); spriteCtx.lineTo(radius * .14, radius * .84); spriteCtx.lineTo(0, radius * 1.12); spriteCtx.closePath(); spriteCtx.fill()
    return { sprite, ratio, padding }
  }

  async function loadDetector() {
    if (detector) return detector
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
        const options = { runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .55 }
        try { return await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'GPU' } }) }
        catch { return HandLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'CPU' } }) }
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
        try { return await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' } }) }
        catch { return FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' } }) }
      })().then((value) => { faceDetector = value; return value }).catch((error) => { faceDetectorPromise = null; throw error })
    }
    return faceDetectorPromise
  }

  async function enableCamera() {
    if (!active || starting || ready) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say('카메라를 사용하려면 HTTPS 또는 localhost에서 열어 주세요.', true)
      return
    }
    const attempt = ++generation
    starting = true; startButton.disabled = true; startButton.textContent = '카메라 연결 중…'; status.textContent = ''
    let acquired: MediaStream | null = null
    let phase = 'camera'
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } })
      if (!active || generation !== attempt) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired; video.srcObject = acquired; await video.play()
      phase = 'tracking'; startButton.textContent = '손 트래킹 준비 중…'; await loadDetector()
      if (!active || generation !== attempt) { acquired.getTracks().forEach(track => track.stop()); return }
      ready = true; gate.hidden = true; root.classList.add('is-ready'); live.textContent = 'LIVE'; lastVideoTime = -1
      void loadFaceDetector().catch(() => {})
      say('검지로 풍선을 터뜨리거나, 엄지와 검지로 끈을 잡아 보세요.')
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream === acquired) { releaseCamera(); say('카메라 연결이 끊겼어요. 다시 켜 주세요.', true) }
      }, { once: true })
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop())
      if (generation !== attempt) return
      stream = null; video.srcObject = null
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      say(phase === 'tracking' ? '손 인식을 준비하지 못했어요. 다시 시도해 주세요.' : denied ? '카메라 권한을 허용해 주세요.' : '카메라를 연결하지 못했어요. 다른 앱에서 사용 중인지 확인해 주세요.', true)
    } finally {
      if (generation === attempt) { starting = false; startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>' }
    }
  }

  function makeBalloon() {
    // Discrete size bands keep small, medium, and oversized balloons visibly
    // distinct instead of clustering around a single average size.
    const sizeBand = [.56, .72, .9, 1.08, 1.32, 1.58][Math.floor(Math.random() * 6)]
    const radius = clamp(clamp(width * .064, 34, 58) * sizeBand * rand(.9, 1.1), 20, 98)
    const color = palette[Math.floor(Math.random() * palette.length)]
    const cached = createBalloonSprite(color, radius)
    return {
      id: nextId++, x: rand(radius, Math.max(radius + 1, width - radius)), y: height + radius * rand(1.1, 2.2),
      vx: rand(-12, 12), vy: rand(-62, -35), radius, color,
      stringLength: rand(70, 150), sway: rand(0, Math.PI * 2), heldBy: null, sprite: cached.sprite, spritePixelRatio: cached.ratio, spritePadding: cached.padding,
      displayScale: 1, blow: null,
    }
  }

  function reset() {
    balloons = Array.from({ length: constrained ? 8 : 12 }, makeBalloon)
    fragments = []; pinches.clear(); spawnClock = 0; updateCount()
  }

  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect()
    const oldWidth = width; const oldHeight = height
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
    pixelRatio = Math.min(devicePixelRatio || 1, 2, 1600 / Math.max(width, height))
    const canvasWidth = Math.max(2, Math.round(width * pixelRatio / 2) * 2)
    const canvasHeight = Math.max(2, Math.round(height * pixelRatio / 2) * 2)
    if (canvas.width !== canvasWidth) canvas.width = canvasWidth
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight
    for (const balloon of balloons) {
      balloon.x *= width / oldWidth; balloon.y *= height / oldHeight; balloon.radius *= Math.sqrt(width / oldWidth)
      const cached = createBalloonSprite(balloon.color, balloon.radius)
      balloon.sprite = cached.sprite; balloon.spritePixelRatio = cached.ratio; balloon.spritePadding = cached.padding
    }
    for (const fragment of fragments) { fragment.x *= width / oldWidth; fragment.y *= height / oldHeight }
  }

  function matchSlots(points: Point[]) {
    if (points.length === 1 && pinches.size) {
      const [slot] = [...pinches].sort((a, b) => Math.hypot(a[1].x - points[0].x, a[1].y - points[0].y) - Math.hypot(b[1].x - points[0].x, b[1].y - points[0].y))[0]
      return [slot]
    }
    if (points.length !== 2 || !pinches.has(0) || !pinches.has(1)) return [0, 1]
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
    const direct = distance(points[0], pinches.get(0)!) + distance(points[1], pinches.get(1)!)
    const crossed = distance(points[0], pinches.get(1)!) + distance(points[1], pinches.get(0)!)
    return crossed < direct ? [1, 0] : [0, 1]
  }

  function trackHands(now: number) {
    if (!ready || !detector || video.readyState < 2 || now - lastDetection < detectionInterval || video.currentTime === lastVideoTime) return
    lastDetection = now; lastVideoTime = video.currentTime
    const iw = constrained ? 512 : 640; const ih = Math.round(iw * video.videoHeight / video.videoWidth)
    if (!ih) return
    if (input.width !== iw || input.height !== ih) { input.width = iw; input.height = ih }
    inputCtx.setTransform(-1, 0, 0, 1, iw, 0); inputCtx.drawImage(video, 0, 0, iw, ih); inputCtx.resetTransform()
    try {
      const result = detector.detectForVideo(input, now)
      const centers = result.landmarks.slice(0, 2).map(hand => coverPoint(hand[9], iw, ih, width, height))
      const slots = matchSlots(centers)
      const next = new Map<number, Pinch>()
      result.landmarks.slice(0, 2).forEach((hand, index) => {
        const indexTip = coverPoint(hand[8], iw, ih, width, height)
        const thumbTip = coverPoint(hand[4], iw, ih, width, height)
        const pinch = { x: (indexTip.x + thumbTip.x) / 2, y: (indexTip.y + thumbTip.y) / 2 }
        next.set(slots[index], { ...pinch, id: slots[index], index: indexTip, pinching: Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y) < clamp(width * .055, 28, 54), seen: now })
      })
      pinches = next
      for (const hand of next.values()) burstAt(hand.index.x, hand.index.y, hand.pinching ? 0 : 1)
      trackFace(now)
    } catch {
      releaseCamera(); say('손 인식이 중단됐어요. 카메라를 다시 켜 주세요.', true)
    }
  }

  function trackFace(now: number) {
    if (!faceDetector || now - lastFaceDetection < faceDetectionInterval) return
    lastFaceDetection = now
    try {
      const face = faceDetector.detectForVideo(input, now).faceLandmarks[0]
      if (!face) return
      const upper = face[13]; const lower = face[14]; const leftCorner = face[61]; const rightCorner = face[291]
      const point = coverPoint({ x: (upper.x + lower.x) / 2, y: (upper.y + lower.y) / 2 }, input.width, input.height, width, height)
      const mouthWidth = Math.hypot(leftCorner.x - rightCorner.x, leftCorner.y - rightCorner.y)
      const opening = Math.hypot(upper.x - lower.x, upper.y - lower.y)
      const rounded = mouthWidth > .02 && opening / mouthWidth > .24
      mouth = mouth
        ? { x: mouth.x + (point.x - mouth.x) * .72, y: mouth.y + (point.y - mouth.y) * .72, rounded, seen: now }
        : { ...point, rounded, seen: now }
    } catch { mouth = null }
  }

  function stringEnd(balloon: Balloon, now: number): Point {
    const hand = balloon.heldBy === null ? null : pinches.get(balloon.heldBy)
    if (hand?.pinching && now - hand.seen < 240) return hand
    const radius = balloon.radius * balloon.displayScale
    return { x: balloon.x + Math.sin(now / 650 + balloon.sway) * radius * .12, y: balloon.y + radius * 1.18 + balloon.stringLength }
  }

  function pointToStringDistance(point: Point, balloon: Balloon, now: number) {
    const start = { x: balloon.x, y: balloon.y + balloon.radius * balloon.displayScale * .92 }
    const end = stringEnd(balloon, now)
    const dx = end.x - start.x; const dy = end.y - start.y
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1)
    return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t))
  }

  function burst(balloon: Balloon) {
    const scale = balloon.radius / 50
    const pieces = Math.round(clamp(10 + scale * 11, 11, 28))
    for (let i = 0; i < pieces; i++) {
      const angle = Math.PI * 2 * i / pieces + rand(-.18, .18)
      const speed = rand(65 + scale * 55, 145 + scale * 225)
      fragments.push({
        x: balloon.x, y: balloon.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        angle, spin: rand(-10, 10) * (0.75 + scale * .35), size: rand(2.5 + scale * 2, 6 + scale * 9),
        color: balloon.color, life: rand(.34 + scale * .12, .62 + scale * .38),
      })
    }
    balloons = balloons.filter(item => item !== balloon)
  }

  function burstAt(x: number, y: number, enabled: number) {
    if (!enabled) return
    const target = balloons.find(balloon => Math.hypot(x - balloon.x, y - balloon.y) < balloon.radius * balloon.displayScale * .86)
    if (target) burst(target)
  }

  function update(dt: number, now: number) {
    if (mouth && now - mouth.seen > 520) mouth = null
    for (const balloon of balloons) {
      const hand = balloon.heldBy === null ? null : pinches.get(balloon.heldBy)
      if (!hand?.pinching || now - hand.seen > 240) balloon.heldBy = null
    }
    for (const hand of pinches.values()) {
      if (!hand.pinching) continue
      const alreadyHeld = balloons.some(balloon => balloon.heldBy === hand.id)
      if (alreadyHeld) continue
      let closest: Balloon | null = null; let closestDistance = Infinity
      for (const balloon of balloons) {
        if (balloon.heldBy !== null) continue
        const distance = pointToStringDistance(hand, balloon, now)
        if (distance < Math.max(22, balloon.radius * .28) && distance < closestDistance) { closest = balloon; closestDistance = distance }
      }
      if (closest) { closest.heldBy = hand.id; closest.vx *= .35; closest.vy *= .35 }
    }
    for (const balloon of balloons) {
      const nearRoundedMouth = !!mouth?.rounded && Math.hypot(mouth.x - balloon.x, mouth.y - balloon.y) < balloon.radius * 1.18
      if (nearRoundedMouth) {
        balloon.blow ??= { x: balloon.x, y: balloon.y, phase: rand(0, Math.PI * 2) }
      }
      if (balloon.blow) {
        const targetScale = nearRoundedMouth ? 2.12 + Math.sin(now / 135 + balloon.blow.phase) * .075 : 1
        const ease = 1 - Math.exp(-(nearRoundedMouth ? 4.8 : 7.5) * dt)
        balloon.displayScale += (targetScale - balloon.displayScale) * ease
        const sway = nearRoundedMouth ? balloon.radius * (.15 + (balloon.displayScale - 1) * .12) : 0
        const targetX = balloon.blow.x + Math.sin(now / 165 + balloon.blow.phase) * sway
        const targetY = balloon.blow.y + Math.cos(now / 205 + balloon.blow.phase * 1.7) * sway * .62
        balloon.x += (targetX - balloon.x) * (1 - Math.exp(-8 * dt))
        balloon.y += (targetY - balloon.y) * (1 - Math.exp(-8 * dt))
        const pinched = balloon.heldBy === null ? null : pinches.get(balloon.heldBy)
        if (pinched?.pinching && now - pinched.seen < 240) {
          // The balloon can swell toward the camera, but its string endpoint
          // remains at the pinch. Correct the balloon onto that fixed-length
          // orbit after every wind-motion update.
          const knotX = balloon.x; const knotY = balloon.y + balloon.radius * balloon.displayScale * .92
          const toPinchX = pinched.x - knotX; const toPinchY = pinched.y - knotY
          const distance = Math.max(1, Math.hypot(toPinchX, toPinchY))
          const correction = distance - balloon.stringLength
          balloon.x += toPinchX / distance * correction
          balloon.y += toPinchY / distance * correction
        }
        balloon.vx = 0; balloon.vy = 0
        if (!nearRoundedMouth && Math.abs(balloon.displayScale - 1) < .015 && Math.hypot(balloon.x - balloon.blow.x, balloon.y - balloon.blow.y) < 1) balloon.blow = null
        continue
      }
      if (balloon.heldBy === null) {
        balloon.vx += Math.sin(now / 750 + balloon.sway) * 5 * dt
        const riseSpeed = -clamp(40 + balloon.radius * .16, 42, 60)
        balloon.vx *= Math.exp(-.75 * dt); balloon.vy += (riseSpeed - balloon.vy) * Math.min(1, dt * .5)
        balloon.x += balloon.vx * dt; balloon.y += balloon.vy * dt
        if (balloon.x < balloon.radius || balloon.x > width - balloon.radius) balloon.vx *= -1
      } else {
        const hand = pinches.get(balloon.heldBy)!
        // Helium keeps pulling upward. The fixed-length constraint removes the
        // rope-direction motion but preserves its tangential component, so a
        // stopped hand naturally leaves the balloon above the string end.
        balloon.vy -= 420 * dt
        balloon.vx *= Math.exp(-2.4 * dt); balloon.vy *= Math.exp(-2.4 * dt)
        balloon.x += balloon.vx * dt; balloon.y += balloon.vy * dt
        const movedKnotX = balloon.x
        const movedKnotY = balloon.y + balloon.radius * .92
        const toHandX = hand.x - movedKnotX; const toHandY = hand.y - movedKnotY
        const distance = Math.max(1, Math.hypot(toHandX, toHandY))
        const correction = distance - balloon.stringLength
        balloon.x += toHandX / distance * correction
        balloon.y += toHandY / distance * correction
        // Remove radial velocity so the following frame starts on the same
        // fixed-length orbit, while preserving swing around the pinch point.
        const radialVelocity = (balloon.vx * toHandX + balloon.vy * toHandY) / distance
        balloon.vx -= toHandX / distance * radialVelocity
        balloon.vy -= toHandY / distance * radialVelocity
      }
    }
    balloons = balloons.filter(balloon => balloon.heldBy !== null || balloon.y + balloon.radius > -30)
    spawnClock += dt
    const targetCount = constrained ? 12 : 18
    if (spawnClock > .45 && balloons.length < targetCount) { balloons.push(makeBalloon()); spawnClock = 0 }
    fragments = fragments.filter(fragment => {
      fragment.vy += 530 * dt; fragment.x += fragment.vx * dt; fragment.y += fragment.vy * dt; fragment.angle += fragment.spin * dt; fragment.life -= dt
      return fragment.life > 0 && fragment.y < height + 70
    }).slice(-180)
    updateCount()
  }

  function drawBalloon(balloon: Balloon, now: number) {
    const r = balloon.radius * balloon.displayScale; const end = stringEnd(balloon, now)
    const knotY = balloon.y + r * .92
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,.78)'; ctx.lineWidth = Math.max(1, r * .018)
    ctx.beginPath(); ctx.moveTo(balloon.x, knotY)
    if (balloon.heldBy === null) ctx.quadraticCurveTo(balloon.x + Math.sin(now / 500 + balloon.sway) * r * .38, (knotY + end.y) / 2, end.x, end.y)
    else ctx.lineTo(end.x, end.y)
    ctx.stroke()
    const spriteWidth = balloon.sprite.width / balloon.spritePixelRatio * balloon.displayScale
    const spriteHeight = balloon.sprite.height / balloon.spritePixelRatio * balloon.displayScale
    ctx.drawImage(balloon.sprite, balloon.x - spriteWidth / 2, balloon.y - (balloon.radius + balloon.spritePadding) * balloon.displayScale, spriteWidth, spriteHeight)
    ctx.restore()
  }

  function draw(now: number) {
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
    ctx.fillStyle = '#172533'; ctx.fillRect(0, 0, width, height)
    if (ready && video.readyState >= 2) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const vw = video.videoWidth * scale; const vh = video.videoHeight * scale
      ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(video, (width - vw) / 2, (height - vh) / 2, vw, vh); ctx.restore()
    }
    const shade = ctx.createLinearGradient(0, 0, 0, height); shade.addColorStop(0, 'rgba(6,18,35,.26)'); shade.addColorStop(.5, 'rgba(6,18,35,0)'); shade.addColorStop(1, 'rgba(6,18,35,.22)')
    ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height)
    for (const balloon of balloons) drawBalloon(balloon, now)
    for (const fragment of fragments) {
      ctx.save(); ctx.globalAlpha = Math.min(1, fragment.life * 2); ctx.translate(fragment.x, fragment.y); ctx.rotate(fragment.angle); ctx.fillStyle = fragment.color
      ctx.beginPath(); ctx.moveTo(-fragment.size, -fragment.size * .45); ctx.lineTo(fragment.size, 0); ctx.lineTo(-fragment.size * .4, fragment.size * .55); ctx.closePath(); ctx.fill(); ctx.restore()
    }
  }

  function animate(now: number) {
    if (!active || paused || document.hidden) return
    frame = requestAnimationFrame(animate)
    const callbackDelay = now - lastAnimationCallback
    lastAnimationCallback = now
    if (callbackDelay > 50) {
      adaptiveFrameInterval = Math.min(100, Math.max(adaptiveFrameInterval, callbackDelay * 1.35))
      throttledUntil = now + 3000
    } else if (now > throttledUntil) adaptiveFrameInterval += (frameInterval - adaptiveFrameInterval) * .08
    if (now - lastTime < adaptiveFrameInterval) return
    const dt = Math.min((now - (lastTime || now)) / 1000, .05); lastTime = now
    trackHands(now); update(dt, now)
    const renderStart = performance.now(); draw(now)
    const renderCost = performance.now() - renderStart
    const safeInterval = renderCost > frameInterval * .75
      ? Math.min(100, Math.max(frameInterval, renderCost * 1.55))
      : now < throttledUntil ? adaptiveFrameInterval : frameInterval
    adaptiveFrameInterval += (safeInterval - adaptiveFrameInterval) * .22
  }

  function releaseCamera() {
    ++generation; starting = false; ready = false; pinches.clear(); mouth = null
    stream?.getTracks().forEach(track => track.stop()); stream = null
    video.pause(); video.srcObject = null
    detector?.close(); detector = null; detectorPromise = null
    faceDetector?.close(); faceDetector = null; faceDetectorPromise = null
    gate.hidden = false; root.classList.remove('is-ready'); live.textContent = 'CAMERA OFF'
    startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>'
  }

  startButton.addEventListener('click', () => { void enableCamera() })
  q('.balloon__reset').addEventListener('click', reset)
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) { releaseCamera(); cancelAnimationFrame(frame) }
    else if (active && !paused) { lastTime = 0; frame = requestAnimationFrame(animate) }
  })
  window.addEventListener('pagehide', () => { if (active) { releaseCamera(); cancelAnimationFrame(frame) } })

  return {
    captureFrame: () => canvas,
    start() {
      if (active) return
      active = true; paused = false; resize(); reset(); lastTime = 0; lastAnimationCallback = performance.now(); adaptiveFrameInterval = frameInterval; throttledUntil = 0; frame = requestAnimationFrame(animate)
    },
    stop() { if (!active) return; active = false; paused = false; releaseCamera(); cancelAnimationFrame(frame); clearTimeout(statusTimer); status.textContent = '' },
    setPaused(value: boolean) {
      paused = value
      if (paused) { cancelAnimationFrame(frame); video.pause() }
      else if (active) { void video.play().catch(() => {}); lastTime = 0; lastAnimationCallback = performance.now(); adaptiveFrameInterval = frameInterval; throttledUntil = 0; frame = requestAnimationFrame(animate) }
    },
  }
}
