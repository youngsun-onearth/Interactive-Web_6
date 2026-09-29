import './shampoo.css'
import type { FaceLandmarker, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'
import { coverPoint, isClosedFist } from './lemonade-physics'
import { createFoamChain, type FoamNode, type FoamPoint } from './shampoo-physics'
import { extractHumanHeadShape, smoothHeadShape, type HeadShape } from './shampoo-head-shape'

type Point = FoamPoint
type FacePose = {
  root: Point
  forehead: Point
  earCenter: Point
  up: Point
  width: number
  height: number
  seen: number
}
// A scalp bubble is positioned in the area enclosed by the forehead line and
// the HumanSeg silhouette. `bleed` lets bubbles at that outline overlap it a
// little, so the foam does not read as a clipped sticker.
type ScalpBubble = { level: number; side: number; size: number; phase: number; depth: number; bleed: number }
type HeadProfile = { halfWidthRatio: number; riseRatio: number }
type FaceLocalPoint = { u: number; v: number }
type TrackedHand = Point & {
  id: number
  pinching: boolean
  seen: number
  vx: number
  vy: number
  touchRadius: number
  touchPoints: Point[]
  fist: boolean
  palm: Point
}
type ClusterBubble = { x: number; y: number; radius: number; phase: number; depth: number; core: number }
type ClusterSprite = { canvas: HTMLCanvasElement; originX: number; originY: number }
type FoamClusterMode = 'floating' | 'attached'
type FlyingFoamCluster = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  rotation: number
  spin: number
  buoyancy: number
  bubbles: ClusterBubble[]
  mode: FoamClusterMode
  scale: number
  attachment?: FaceLocalPoint
  attachmentReferenceWidth?: number
  attachmentRotationOffset?: number
  attachmentLandmarkIndex?: number
  attachmentLandmarkOffset?: FaceLocalPoint
  sprite?: ClusterSprite
  wash: number
}
type ShowerPhase = 'hidden' | 'arriving' | 'ready' | 'grabbing' | 'raining' | 'clearing' | 'regenerating'
type RainDrop = { x: number; y: number; previousY: number; speed: number; length: number; width: number; alpha: number }
type FoamTarget = { index: number; x: number; y: number; radius: number }
type FaceFoamStroke = { lastPoint: Point; lastStamp: number }
type FistFoamStroke = { lastPoint: Point; lastStamp: number }
type FoamRestOffset = { across: number; along: number }
type FoamShapeControl = FoamRestOffset & { progress: number }
type HandTrackerMessage = {
  type: 'ready' | 'result' | 'error'
  timestamp?: number
  width?: number
  height?: number
  landmarks?: Point[][]
  message?: string
}

const BASE = import.meta.env.BASE_URL
const NODE_COUNT = 10
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const constrained = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
// Keep drawing at display cadence even while inference is throttled below.
// This lets the smoothed physical curve bridge detector samples instead of
// visibly stepping between them.
const frameInterval = 1000 / (constrained ? 30 : 60)
const faceDetectionInterval = constrained ? 82 : 56
const handDetectionInterval = constrained ? 44 : 30
const segmentationInterval = constrained ? 620 : 440
const FACE_TRACKING_GRACE = 760
const HAND_TRACKING_GRACE = 950
const FIST_BLOOM_INTERVAL = constrained ? 460 : 360
const DEFAULT_HEAD_PROFILE: HeadProfile = { halfWidthRatio: .68, riseRatio: .58 }
const FOAM_CONTROL_PROGRESS = [.34, .67, 1] as const
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

function makeFoamShapeControls(): FoamShapeControl[] {
  return FOAM_CONTROL_PROGRESS.map(progress => ({ progress, across: 0, along: 0 }))
}

function paintSoapBubble(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  depth: number,
  opacity: number,
  phase: number,
  core = 0,
) {
  const hue = 174 + Math.sin(phase) * 20
  context.globalAlpha = opacity * (.52 + depth * .4)
  context.fillStyle = `rgba(252,255,254,${.1 + core * .78})`
  context.strokeStyle = `hsla(${hue},58%,${74 + core * 18}%,${.34 + core * .42 + depth * .12})`
  context.lineWidth = Math.max(.65, radius * .09)
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke()

  context.globalAlpha = opacity * (.54 + core * .32 + depth * .12)
  context.strokeStyle = 'rgba(255,255,255,.9)'
  context.lineWidth = Math.max(.62, radius * .105)
  context.beginPath(); context.arc(x - radius * .12, y - radius * .16, radius * .72, Math.PI * 1.03, Math.PI * 1.53); context.stroke()

  context.globalAlpha = opacity * (.28 + core * .24 + depth * .2)
  context.strokeStyle = `hsla(${302 + Math.sin(phase * 1.7) * 28},70%,82%,.72)`
  context.lineWidth = Math.max(.55, radius * .075)
  context.beginPath(); context.arc(x + radius * .05, y + radius * .08, radius * .8, .08, .72); context.stroke()
}

const SOAP_SPRITE_SIZE = 64
const SOAP_SPRITE_RADIUS = 24
const soapSpriteCache = new Map<string, HTMLCanvasElement>()

function soapBubbleSprite(depth: number, phase: number, core: number) {
  const phaseBucket = Math.round(((phase % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 11)
  const depthBucket = Math.round(clamp(depth, 0, 1) * 3)
  const coreBucket = Math.round(clamp(core, 0, 1) * 5)
  const key = `${phaseBucket}:${depthBucket}:${coreBucket}`
  const cached = soapSpriteCache.get(key)
  if (cached) return cached
  const sprite = document.createElement('canvas')
  sprite.width = SOAP_SPRITE_SIZE; sprite.height = SOAP_SPRITE_SIZE
  const spriteContext = sprite.getContext('2d', { alpha: true })!
  paintSoapBubble(
    spriteContext,
    SOAP_SPRITE_SIZE / 2,
    SOAP_SPRITE_SIZE / 2,
    SOAP_SPRITE_RADIUS,
    depthBucket / 3,
    1,
    phaseBucket / 12 * Math.PI * 2,
    coreBucket / 5,
  )
  soapSpriteCache.set(key, sprite)
  return sprite
}

function drawSoapBubble(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  depth: number,
  opacity: number,
  phase: number,
  core = 0,
) {
  const sprite = soapBubbleSprite(depth, phase, core)
  const halfSize = radius / SOAP_SPRITE_RADIUS * SOAP_SPRITE_SIZE / 2
  context.globalAlpha = opacity
  context.drawImage(sprite, x - halfSize, y - halfSize, halfSize * 2, halfSize * 2)
}

function makeScalpBubbles(seed: number) {
  let state = (seed ^ 0x9e3779b9) >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const rows = constrained ? 30 : 38
  const columns = constrained ? 32 : 40
  const result: ScalpBubble[] = []
  for (let index = 0; index < rows * columns; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    // Let edge centres extend beyond the silhouette. Their larger radii make
    // the perimeter feel full and irregular instead of mask-clipped.
    const side = ((column + .04 + random() * .92) / columns) * 2.2 - 1.1
    const keepChance = .34 + Math.pow(1 - Math.abs(side), .72) * .66
    if (random() > keepChance) continue
    result.push({
      level: clamp((row - .24 + random() * .76) / Math.max(1, rows - 1), 0, 1),
      side,
      size: .036 + Math.pow(random(), .74) * .062,
      phase: random() * Math.PI * 2,
      depth: random(),
      bleed: .05 + random() * .04,
    })
  }
  return result.sort((a, b) => a.depth - b.depth)
}

function poseFromLandmarks(points: Point[], now: number): FacePose | null {
  const forehead = points[10]; const chin = points[152]
  const leftSide = points[234]; const rightSide = points[454]
  const leftEar = points[127] ?? leftSide; const rightEar = points[356] ?? rightSide
  const leftEye = points[33]; const rightEye = points[263]
  if (!forehead || !chin || !leftSide || !rightSide || !leftEye || !rightEye) return null
  const eyeDx = rightEye.x - leftEye.x; const eyeDy = rightEye.y - leftEye.y
  const eyeLength = Math.max(1, Math.hypot(eyeDx, eyeDy))
  const up = { x: eyeDy / eyeLength, y: -eyeDx / eyeLength }
  const width = Math.max(1, Math.hypot(rightSide.x - leftSide.x, rightSide.y - leftSide.y))
  const height = Math.max(1, Math.hypot(chin.x - forehead.x, chin.y - forehead.y))
  const earCenter = { x: (leftEar.x + rightEar.x) / 2, y: (leftEar.y + rightEar.y) / 2 }
  return {
    root: { x: earCenter.x + up.x * height * .55, y: earCenter.y + up.y * height * .55 },
    forehead, earCenter, up, width, height, seen: now,
  }
}

function foamBaseRadius(pose: FacePose) {
  return pose.width * .6
}

function foamRadius(pose: FacePose, progress: number) {
  const start = foamBaseRadius(pose)
  // Kept for the invisible touch rig that drives scalp foam inertia.
  const end = pose.width * .43
  const eased = Math.pow(clamp(progress, 0, 1), .82)
  return mix(start, end, eased)
}

function foamHeight(pose: FacePose) {
  // Internal touch rig extent; it is never rendered as a foam column.
  return pose.height * .62
}

function smoothPose(previous: FacePose | null, next: FacePose) {
  if (!previous) return next
  const movement = Math.hypot(next.root.x - previous.root.x, next.root.y - previous.root.y) / Math.max(1, previous.width)
  const amount = clamp(.46 + movement * 2.8, .46, .84)
  let upX = mix(previous.up.x, next.up.x, amount)
  let upY = mix(previous.up.y, next.up.y, amount)
  const length = Math.max(.001, Math.hypot(upX, upY))
  upX /= length; upY /= length
  return {
    root: { x: mix(previous.root.x, next.root.x, amount), y: mix(previous.root.y, next.root.y, amount) },
    forehead: { x: mix(previous.forehead.x, next.forehead.x, amount), y: mix(previous.forehead.y, next.forehead.y, amount) },
    earCenter: { x: mix(previous.earCenter.x, next.earCenter.x, amount), y: mix(previous.earCenter.y, next.earCenter.y, amount) },
    up: { x: upX, y: upY },
    width: mix(previous.width, next.width, amount),
    height: mix(previous.height, next.height, amount),
    seen: next.seen,
  }
}

function faceLocal(point: Point, pose: FacePose): FaceLocalPoint {
  const across = { x: -pose.up.y, y: pose.up.x }
  const dx = point.x - pose.earCenter.x; const dy = point.y - pose.earCenter.y
  return {
    u: (dx * across.x + dy * across.y) / Math.max(1, pose.width),
    v: (dx * pose.up.x + dy * pose.up.y) / Math.max(1, pose.height),
  }
}

function faceWorld(point: FaceLocalPoint, pose: FacePose): Point {
  const across = { x: -pose.up.y, y: pose.up.x }
  return {
    x: pose.earCenter.x + across.x * point.u * pose.width + pose.up.x * point.v * pose.height,
    y: pose.earCenter.y + across.y * point.u * pose.width + pose.up.y * point.v * pose.height,
  }
}

function closestPointOnPath(point: Point, path: Point[]) {
  let closest = path[0] ?? point
  let closestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < path.length; index += 1) {
    const first = path[index]
    const second = path[(index + 1) % path.length]
    const dx = second.x - first.x; const dy = second.y - first.y
    const lengthSquared = dx * dx + dy * dy
    const amount = lengthSquared ? clamp(((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared, 0, 1) : 0
    const candidate = { x: first.x + dx * amount, y: first.y + dy * amount }
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
    if (distance < closestDistance) { closest = candidate; closestDistance = distance }
  }
  return { point: closest, distance: closestDistance }
}

function insidePolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const first = polygon[index]; const second = polygon[previous]
    if ((first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x) inside = !inside
  }
  return inside
}

export function createShampoo(root: HTMLElement) {
  root.innerHTML = `
    <video class="shampoo__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="shampoo__canvas" aria-label="이마 위 HumanSeg 머리 영역을 따라 움직이는 샴푸 거품"></canvas>
    <header class="shampoo__header"><p>FACE INTERACTION / 12</p><h2>Shampoo</h2><span>Move slowly. Let the foam follow.</span></header>
    <div class="shampoo__readout"><span class="shampoo__live">CAMERA OFF</span><strong class="shampoo__mode">WAITING</strong></div>
    <div class="shampoo__pinch" aria-hidden="true"><span></span></div>
    <div class="shampoo__shower" aria-hidden="true">
      <span class="shampoo__shower-pipe"></span>
      <span class="shampoo__shower-plate"></span>
      <span class="shampoo__shower-slot"></span>
      <span class="shampoo__shower-lever"></span>
      <span class="shampoo__shower-grip"></span>
    </div>
    <div class="shampoo__gate">
      <div class="shampoo__symbol" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <p class="shampoo__eyebrow">LATHER UP</p>
      <h3>거품 머리를 만들어 볼까요?</h3>
      <p>얼굴을 인식하면 이마 위 머리카락 영역을 거품으로 채워요.<br>머리 전체가 화면에 들어오게 비춰 보세요.</p>
      <button class="shampoo__start" type="button">카메라 켜기 <span>↗</span></button>
      <small>카메라 영상은 기기 안에서만 처리됩니다.</small>
    </div>
    <p class="shampoo__hint">거품이 생기면 오른쪽 위 레버를 주먹으로 잡아 당겨 보세요</p>
    <button class="shampoo__refresh" type="button">새 거품 ↻</button>
    <p class="shampoo__status" role="status" aria-live="polite"></p>
  `

  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const video = q<HTMLVideoElement>('.shampoo__camera')
  const canvas = q<HTMLCanvasElement>('.shampoo__canvas')
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true })!
  const input = document.createElement('canvas')
  const inputContext = input.getContext('2d', { alpha: false })!
  const handInput = document.createElement('canvas')
  const handInputContext = handInput.getContext('2d', { alpha: false })!
  const segmentationInput = document.createElement('canvas')
  const segmentationInputContext = segmentationInput.getContext('2d', { alpha: false })!
  const gate = q<HTMLDivElement>('.shampoo__gate')
  const startButton = q<HTMLButtonElement>('.shampoo__start')
  const live = q<HTMLSpanElement>('.shampoo__live')
  const mode = q<HTMLElement>('.shampoo__mode')
  const status = q<HTMLParagraphElement>('.shampoo__status')
  const shower = q<HTMLDivElement>('.shampoo__shower')
  const showerGrip = q<HTMLSpanElement>('.shampoo__shower-grip')
  let active = false
  let paused = false
  let ready = false
  let starting = false
  let generation = 0
  let stream: MediaStream | null = null
  let detector: FaceLandmarker | null = null
  let handDetector: HandLandmarker | null = null
  let handWorker: Worker | null = null
  let handInferenceBusy = false
  let segmenter: ImageSegmenter | null = null
  let trackerPromise: Promise<FaceLandmarker> | null = null
  let pose: FacePose | null = null
  let headShape: HeadShape | null = null
  let headProfile: HeadProfile | null = null
  let hands = new Map<number, TrackedHand>()
  let lastFoamOutline: Point[] = []
  let lastColumnOutline: Point[] = []
  let lastFaceBoundary: Point[] = []
  let lastFaceLandmarks: Point[] = []
  let nodes: FoamNode[] = []
  let renderNodes: FoamNode[] = []
  let scalpBubbles = makeScalpBubbles(Date.now())
  let flyingClusters: FlyingFoamCluster[] = []
  let faceFoamStrokes = new Map<number, FaceFoamStroke>()
  let fistFoamStrokes = new Map<number, FistFoamStroke>()
  let foamShapeControls: FoamShapeControl[] = makeFoamShapeControls()
  let fistBloomCount = 0
  let motionRoot: Point | null = null
  let motionSampleTime = 0
  let headVelocity: Point = { x: 0, y: 0 }
  // A shared inertial frame is applied to the scalp cap and every column
  // joint at draw time. It makes the whole foam mass move as one object
  // rather than anchoring the forehead while the top swings independently.
  let foamFrameOffset: Point = { x: 0, y: 0 }
  let foamFrameVelocity: Point = { x: 0, y: 0 }
  let foamTipSway: Point = { x: 0, y: 0 }
  let foamTipSwayVelocity: Point = { x: 0, y: 0 }
  let shedAccumulator = 0
  let peakFoamBend = 0
  let peakFlyingClusters = 0
  let flightRandomState = Date.now() >>> 0
  let foamOpacity = 0
  let baseFoamOpacity = 1
  let baseFoamTarget = 1
  let scalpBubbleWash: number[] = []
  let defaultFoamTargets: FoamTarget[] = []
  let rainDrops: RainDrop[] = []
  let showerPhase: ShowerPhase = 'hidden'
  let showerPhaseStartedAt = 0
  let showerArrival = 0
  let showerPull = 0
  let showerGrabbedHand: number | null = null
  let showerGrabStartY = 0
  let showerRainElapsed = 0
  let showerRainAccumulator = 0
  let showerRebuildAt = 0
  let showerClearStarted = false
  let frame = 0
  let lastFrame = 0
  let lastFaceDetection = 0
  let lastHandDetection = 0
  let lastSegmentation = 0
  let lastVideoTime = -1
  let visionTurn: 'face' | 'hand' = 'face'
  let trackingFailures = 0
  let lastDiagnostics = 0
  let width = 1
  let height = 1
  let pixelRatio = 1
  let statusTimer = 0

  const flightRandom = () => {
    flightRandomState = (flightRandomState * 1664525 + 1013904223) >>> 0
    return flightRandomState / 4294967296
  }

  function say(message: string, persistent = false) {
    clearTimeout(statusTimer); status.textContent = message
    if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '' }, 4200)
  }

  function setShowerPhase(phase: ShowerPhase, now: number) {
    showerPhase = phase
    showerPhaseStartedAt = now
    root.dataset.shower = phase
    root.classList.toggle('is-shower-visible', phase !== 'hidden')
    root.classList.toggle('is-shower-grabbed', phase === 'grabbing')
  }

  function syncShowerVisual() {
    // The lever starts fully above the frame and settles at the upper right.
    shower.style.setProperty('--shower-arrival', `${mix(-225, 0, showerArrival)}px`)
    shower.style.setProperty('--shower-pull', `${showerPull * 78}px`)
  }

  function revealShowerIfNeeded(now: number, hasFreshFace: boolean) {
    if (showerPhase === 'hidden' && hasFreshFace && headShape && defaultFoamTargets.length && foamOpacity > .18) {
      setShowerPhase('arriving', now)
      say('첫 거품이 생겼어요. 오른쪽 위 샤워 레버를 주먹으로 잡아 아래로 당겨 보세요.')
    }
    if (showerPhase === 'arriving') {
      showerArrival = clamp((now - showerPhaseStartedAt) / 700, 0, 1)
      if (showerArrival >= 1) setShowerPhase('ready', now)
    }
    syncShowerVisual()
  }

  function leverGripPoint() {
    const bounds = showerGrip.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }

  function updateShowerGrip(now: number) {
    if (showerPhase !== 'ready' && showerPhase !== 'grabbing') return null
    const freshHands = [...hands.values()].filter(hand => hand.fist && now - hand.seen < HAND_TRACKING_GRACE)
    if (showerPhase === 'ready') {
      const grip = leverGripPoint()
      const hand = freshHands.find(candidate => Math.hypot(candidate.palm.x - grip.x, candidate.palm.y - grip.y) < Math.max(44, Math.min(width, height) * .075))
      if (!hand) return null
      showerGrabbedHand = hand.id
      showerGrabStartY = hand.palm.y
      showerPull = 0
      setShowerPhase('grabbing', now)
      return hand.id
    }
    const hand = showerGrabbedHand === null ? null : hands.get(showerGrabbedHand)
    if (hand?.fist && now - hand.seen < HAND_TRACKING_GRACE) {
      showerPull = Math.max(showerPull, clamp((hand.palm.y - showerGrabStartY) / Math.max(48, height * .16), 0, 1))
      syncShowerVisual()
      return hand.id
    }
    // Releasing a fist that caught the grip completes the pull. This keeps the
    // interaction forgiving when the hand detector loses a closing hand.
    showerGrabbedHand = null
    showerPull = 1
    startRain(now)
    return null
  }

  function startRain(now: number) {
    if (showerPhase === 'raining' || showerPhase === 'clearing' || showerPhase === 'regenerating') return
    setShowerPhase('raining', now)
    showerRainElapsed = 0
    showerRainAccumulator = 0
    say('레버를 당겼어요. 물방울이 거품을 씻어 냅니다.')
  }

  function markAllFoamForRinse() {
    scalpBubbleWash = scalpBubbles.map(() => .12)
    for (const cluster of flyingClusters) cluster.wash = Math.max(cluster.wash, .12)
  }

  function finishRinse(now: number) {
    if (showerClearStarted) return
    showerClearStarted = true
    baseFoamTarget = 0
    markAllFoamForRinse()
    setShowerPhase('clearing', now)
    say('남은 거품까지 말끔히 씻어 내고 있어요.')
  }

  function updateShower(deltaTime: number, now: number, hasFreshFace: boolean) {
    revealShowerIfNeeded(now, hasFreshFace)
    baseFoamOpacity += (baseFoamTarget - baseFoamOpacity) * (1 - Math.exp(-deltaTime * 4.8))
    if (showerPhase === 'clearing' && baseFoamOpacity < .035 && !showerRebuildAt) {
      showerRebuildAt = now + 850
    }
    if (showerPhase === 'clearing' && showerRebuildAt && now >= showerRebuildAt) {
      scalpBubbles = makeScalpBubbles(now)
      scalpBubbleWash = []
      baseFoamTarget = 1
      setShowerPhase('regenerating', now)
      say('깨끗한 기본 머리 거품이 다시 피어납니다.')
    }
    root.dataset.rainDrops = String(rainDrops.length)
    root.dataset.foamRinse = baseFoamTarget === 0 ? 'clearing' : showerPhase === 'regenerating' ? 'regenerated' : 'idle'
  }

  function createRainDrop() {
    return {
      x: flightRandom() * width,
      y: -8 - flightRandom() * height * .16,
      previousY: -8,
      speed: height * (.92 + flightRandom() * .34),
      length: 9 + flightRandom() * 15,
      width: .8 + flightRandom() * .9,
      alpha: .34 + flightRandom() * .42,
    }
  }

  function rinseFoamAt(drop: RainDrop) {
    for (const target of defaultFoamTargets) {
      if (scalpBubbleWash[target.index] >= .98) continue
      const nearestY = clamp(target.y, Math.min(drop.previousY, drop.y), Math.max(drop.previousY, drop.y))
      if (Math.hypot(target.x - drop.x, target.y - nearestY) < target.radius + 4) {
        scalpBubbleWash[target.index] = Math.max(scalpBubbleWash[target.index] ?? 0, .26)
        return true
      }
    }
    for (const cluster of flyingClusters) {
      if (cluster.wash >= .98) continue
      const radius = Math.max(18, (cluster.sprite?.canvas.width ?? 36) * cluster.scale * .48)
      const nearestY = clamp(cluster.y, Math.min(drop.previousY, drop.y), Math.max(drop.previousY, drop.y))
      if (Math.hypot(cluster.x - drop.x, cluster.y - nearestY) < radius + 5) {
        cluster.wash = Math.max(cluster.wash, .28)
        return true
      }
    }
    return false
  }

  function updateRain(deltaTime: number, now: number) {
    for (let index = 0; index < scalpBubbleWash.length; index += 1) {
      if (scalpBubbleWash[index] > 0) scalpBubbleWash[index] = Math.min(1, scalpBubbleWash[index] + deltaTime * 2.65)
    }
    if (showerPhase === 'raining') {
      showerRainElapsed += deltaTime
      if (showerRainElapsed < 2.35) {
        showerRainAccumulator += deltaTime * (constrained ? 64 : 96)
        while (showerRainAccumulator >= 1) {
          rainDrops.push(createRainDrop())
          showerRainAccumulator -= 1
        }
      }
    }
    for (const drop of rainDrops) {
      drop.previousY = drop.y
      drop.y += drop.speed * deltaTime
      rinseFoamAt(drop)
    }
    rainDrops = rainDrops.filter(drop => drop.y - drop.length < height + 30)
    if (showerPhase === 'raining' && showerRainElapsed >= 2.35 && !rainDrops.length) finishRinse(now)
  }

  function drawRain() {
    if (!rainDrops.length) return
    context.save()
    context.lineCap = 'round'
    for (const drop of rainDrops) {
      const gradient = context.createLinearGradient(drop.x, drop.y - drop.length, drop.x, drop.y + 2)
      gradient.addColorStop(0, `rgba(241,255,255,${drop.alpha * .1})`)
      gradient.addColorStop(.7, `rgba(212,249,249,${drop.alpha})`)
      gradient.addColorStop(1, `rgba(130,210,217,${drop.alpha * .8})`)
      context.strokeStyle = gradient
      context.lineWidth = drop.width
      context.beginPath(); context.moveTo(drop.x, drop.y - drop.length); context.lineTo(drop.x, drop.y); context.stroke()
    }
    context.restore()
  }

  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect()
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
    pixelRatio = Math.min(devicePixelRatio || 1, constrained ? 1.35 : 1.8, 1600 / Math.max(width, height))
    canvas.width = Math.max(2, Math.round(width * pixelRatio / 2) * 2)
    canvas.height = Math.max(2, Math.round(height * pixelRatio / 2) * 2)
  }

  async function loadTrackers() {
    if (detector && (handDetector || handWorker)) return detector
    if (!trackerPromise) {
      trackerPromise = (async () => {
        const { FilesetResolver, FaceLandmarker, HandLandmarker, ImageSegmenter } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
        const faceOptions = {
          runningMode: 'VIDEO' as const, numFaces: 1,
          minFaceDetectionConfidence: .5, minFacePresenceConfidence: .52, minTrackingConfidence: .48,
        }
        const facePromise = FaceLandmarker.createFromOptions(files, {
          ...faceOptions,
          baseOptions: { modelAssetPath: `${BASE}mediapipe/face_landmarker.task`, delegate: 'GPU' },
        }).catch(() => FaceLandmarker.createFromOptions(files, {
          ...faceOptions,
          baseOptions: { modelAssetPath: `${BASE}mediapipe/face_landmarker.task`, delegate: 'CPU' },
        }))
        const handOptions = {
          runningMode: 'VIDEO' as const, numHands: 2,
          minHandDetectionConfidence: .4, minHandPresenceConfidence: .4, minTrackingConfidence: .4,
        }
        const usesSyntheticHandTracker = Object.prototype.hasOwnProperty.call(window, 'shampooHand')
          || Object.prototype.hasOwnProperty.call(window, 'shampooHands')
        let handPromise: Promise<HandLandmarker | null>
        if (usesSyntheticHandTracker) {
          handPromise = HandLandmarker.createFromOptions(files, {
            ...handOptions,
            baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'GPU' },
          }).catch(() => HandLandmarker.createFromOptions(files, {
            ...handOptions,
            baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'CPU' },
          }))
        } else {
          handPromise = (async () => {
            let candidate: Worker | null = null
            try {
              const { default: HandLandmarkerWorker } = await import('./hand-landmarker.worker?worker&inline')
              candidate = new HandLandmarkerWorker()
              const assets = new URL(BASE, location.href).href
              await new Promise<void>((resolve, reject) => {
                candidate!.onerror = () => reject(new Error('Hand tracking worker failed to initialize.'))
                candidate!.onmessage = (event: MessageEvent<HandTrackerMessage>) => {
                  if (event.data.type === 'ready') resolve()
                  else if (event.data.type === 'error') reject(new Error(event.data.message || 'Hand tracking worker failed.'))
                }
                candidate!.postMessage({ type: 'init', wasmPath: `${assets}mediapipe/wasm`, modelPath: `${assets}mediapipe/hand_landmarker.task` })
              })
              handWorker = candidate
              candidate.onerror = () => {
                handInferenceBusy = false
                root.dataset.handTracker = 'worker-error'
              }
              candidate.onmessage = (event: MessageEvent<HandTrackerMessage>) => {
                if (event.data.type === 'result') {
                  handInferenceBusy = false
                  if (active && ready && handWorker === candidate) {
                    updateHands(event.data.landmarks ?? [], event.data.timestamp ?? performance.now(), event.data.width ?? handInput.width, event.data.height ?? handInput.height)
                  }
                } else if (event.data.type === 'error') {
                  handInferenceBusy = false
                  root.dataset.handTracker = 'worker-error'
                }
              }
              return null
            } catch {
              candidate?.terminate()
              return HandLandmarker.createFromOptions(files, {
                ...handOptions,
                baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'CPU' },
              })
            }
          })()
        }
        // The compact one-class Selfie Segmenter stays on CPU so it does not
        // contend with the GPU face tracker. Its useful output is the selfie
        // confidence mask; a category mask cannot distinguish foreground from
        // background when the model exposes only one category.
        const segmenterPromise = ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${BASE}mediapipe/selfie_segmenter.tflite`, delegate: 'CPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        })
        const [face, hand, humanSegmenter] = await Promise.all([facePromise, handPromise, segmenterPromise])
        if (!humanSegmenter.getLabels().some(label => label.toLowerCase() === 'selfie')) {
          humanSegmenter.close()
          throw new Error('HumanSeg model does not expose the expected selfie confidence mask.')
        }
        handDetector = hand; segmenter = humanSegmenter
        return face
      })().then(value => { detector = value; return value }).catch(error => { trackerPromise = null; throw error })
    }
    return trackerPromise
  }

  async function enableCamera() {
    if (!active || starting || ready) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say('카메라를 사용하려면 HTTPS 또는 localhost에서 열어 주세요.', true); return
    }
    const attempt = ++generation
    starting = true; startButton.disabled = true; startButton.textContent = '카메라 연결 중…'; status.textContent = ''
    let acquired: MediaStream | null = null
    let phase: 'camera' | 'tracking' = 'camera'
    try {
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: constrained ? 960 : 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      })
      if (!active || generation !== attempt) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired; video.srcObject = acquired; await video.play()
      phase = 'tracking'; startButton.textContent = '얼굴 + 손 트래킹 준비 중…'; await loadTrackers()
      if (!active || generation !== attempt) { acquired.getTracks().forEach(track => track.stop()); return }
      root.dataset.humanSeg = 'ready'
      root.dataset.humanSegMask = 'confidence'
      root.dataset.humanSegLabel = segmenter!.getLabels()[0] ?? 'selfie'
      root.dataset.handTracker = handWorker ? 'worker' : 'main'
      ready = true; gate.hidden = true; root.classList.add('is-ready'); live.textContent = 'CAMERA LIVE'; mode.textContent = 'FIND YOUR FACE'
      lastVideoTime = -1; lastFaceDetection = 0; lastHandDetection = 0; lastSegmentation = 0; visionTurn = 'face'; trackingFailures = 0
      say('PINCH는 작은 거품 경로를, 주먹은 촘촘한 큰 거품 군집을 만듭니다.')
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream === acquired) { releaseCamera(); say('카메라 연결이 끊겼어요. 다시 켜 주세요.', true) }
      }, { once: true })
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop())
      if (generation !== attempt) return
      stream = null; video.srcObject = null
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      say(phase === 'tracking' ? '얼굴 인식을 준비하지 못했어요. 다시 시도해 주세요.' : denied ? '카메라 권한을 허용해 주세요.' : '카메라를 연결하지 못했어요.', true)
    } finally {
      if (generation === attempt) { starting = false; startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>' }
    }
  }

  function matchHandSlots(points: Point[]) {
    if (points.length === 1 && hands.size) {
      const nearest = [...hands].sort((a, b) => Math.hypot(a[1].x - points[0].x, a[1].y - points[0].y) - Math.hypot(b[1].x - points[0].x, b[1].y - points[0].y))[0]
      return [nearest?.[0] ?? 0]
    }
    if (points.length !== 2 || !hands.has(0) || !hands.has(1)) return [0, 1]
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
    const direct = distance(points[0], hands.get(0)!) + distance(points[1], hands.get(1)!)
    const crossed = distance(points[0], hands.get(1)!) + distance(points[1], hands.get(0)!)
    return crossed < direct ? [1, 0] : [0, 1]
  }

  function updateHands(landmarks: Point[][], now: number, inputWidth: number, inputHeight: number) {
    const previousHands = hands
    const limited = landmarks.slice(0, 2)
    const palms = limited.map(hand => coverPoint(hand[9], inputWidth, inputHeight, width, height))
    const slots = matchHandSlots(palms)
    const next = new Map<number, TrackedHand>()
    limited.forEach((hand, index) => {
      const thumb = coverPoint(hand[4], inputWidth, inputHeight, width, height)
      const finger = coverPoint(hand[8], inputWidth, inputHeight, width, height)
      const pinch = { x: (thumb.x + finger.x) / 2, y: (thumb.y + finger.y) / 2 }
      const palmWidth = Math.max(.001, Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y))
      const pinchDistance = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y)
      const existing = previousHands.get(slots[index])
      const normalFollow = existing ? (existing.pinching ? .84 : .72) : 1
      const fingerReach = [5, 9, 13, 17].reduce((sum, base) => sum + Math.hypot(
        hand[base + 3].x - hand[base].x,
        hand[base + 3].y - hand[base].y,
      ), 0) / 4
      const fist = fingerReach < palmWidth * .82 && isClosedFist(hand, existing?.fist)
      const nextPinching = !fist && pinchDistance / palmWidth < (existing?.pinching ? .76 : .6)
      // Snap to the actual pinch point on the activation frame. Reusing the
      // open-hand interpolation here would paint a false trail between the
      // previous palm position and the place where the fingers met.
      const follow = nextPinching && !existing?.pinching ? 1 : normalFollow
      const elapsed = existing ? clamp((now - existing.seen) / 1000, 1 / 120, .18) : 1 / 30
      const nextX = existing ? mix(existing.x, pinch.x, follow) : pinch.x
      const nextY = existing ? mix(existing.y, pinch.y, follow) : pinch.y
      const rawVelocityX = existing ? (nextX - existing.x) / elapsed : 0
      const rawVelocityY = existing ? (nextY - existing.y) / elapsed : 0
      const palmLeft = coverPoint(hand[5], inputWidth, inputHeight, width, height)
      const palmRight = coverPoint(hand[17], inputWidth, inputHeight, width, height)
      const touchRadius = Math.max(10, Math.hypot(palmRight.x - palmLeft.x, palmRight.y - palmLeft.y) * .32)
      const touchFollow = existing ? .7 : 1
      const rawTouchPoints = [9, 4, 8, 12, 16, 20].map(pointIndex => coverPoint(hand[pointIndex], inputWidth, inputHeight, width, height))
      const touchPoints = rawTouchPoints.map((point, pointIndex) => {
        const previous = existing?.touchPoints[pointIndex]
        return previous ? { x: mix(previous.x, point.x, touchFollow), y: mix(previous.y, point.y, touchFollow) } : point
      })
      next.set(slots[index], {
        x: nextX,
        y: nextY,
        id: slots[index],
        pinching: nextPinching,
        seen: now,
        vx: existing ? mix(existing.vx, rawVelocityX, .5) : 0,
        vy: existing ? mix(existing.vy, rawVelocityY, .5) : 0,
        touchRadius,
        touchPoints,
        fist,
        palm: palms[index],
      })
    })
    for (const [id, previous] of previousHands) {
      // Keep a short grace period only when the detector lost every hand.
      // If it still sees one hand, a missing second hand has genuinely been
      // released and must not leave a ghost Pinch on the foam column.
      if (!next.has(id) && !limited.length && now - previous.seen < HAND_TRACKING_GRACE) next.set(id, previous)
    }
    hands = next
    root.dataset.handCount = String(hands.size)
    const showerHandId = updateShowerGrip(now)

    for (const handId of faceFoamStrokes.keys()) {
      if (!hands.get(handId)?.pinching) faceFoamStrokes.delete(handId)
    }
    for (const handId of fistFoamStrokes.keys()) {
      if (!hands.get(handId)?.fist) fistFoamStrokes.delete(handId)
    }
    if (pose && lastFoamOutline.length > 2) {
      for (const hand of hands.values()) {
        if (hand.id === showerHandId) continue
        if (showerPhase === 'raining' || showerPhase === 'clearing') continue
        if (hand.fist) {
          faceFoamStrokes.delete(hand.id)
          const stroke = fistFoamStrokes.get(hand.id)
          if (stroke) {
            // A held fist keeps producing foam. The slower cadence and the
            // lighter bloom below preserve that interaction without allowing
            // bubble creation to monopolize the main rendering thread. Once
            // begun on the face/scalp, the stroke deliberately remains active
            // outside that boundary until the user opens their hand.
            if (now - stroke.lastStamp >= FIST_BLOOM_INTERVAL) {
              continueFistFoamStroke(hand, stroke, now)
            }
          } else {
            const start = faceAttachmentPointFor(hand.palm)
            if (start) {
              createFistBloom(start)
              fistFoamStrokes.set(hand.id, { lastPoint: { ...hand.palm }, lastStamp: now })
            }
          }
          continue
        }
        if (!hand.pinching) continue
        const faceStroke = faceFoamStrokes.get(hand.id)
        if (faceStroke) {
          continueFaceFoamStroke(hand, faceStroke, now)
          continue
        }
        // Pinch no longer deforms a column. It paints small, permanent foam
        // along its path on either the face or the HumanSeg scalp mask.
        const facePoint = faceAttachmentPointFor(hand)
        if (facePoint) {
          createFaceFoam(facePoint)
          faceFoamStrokes.set(hand.id, { lastPoint: { x: hand.x, y: hand.y }, lastStamp: now })
          continue
        }
      }
    }
    const firstHand = [...hands.values()][0]
    const interacting = faceFoamStrokes.size > 0 || fistFoamStrokes.size > 0
    root.classList.toggle('has-hand', !!firstHand)
    root.classList.toggle('is-pinching', !!firstHand?.pinching)
    root.classList.toggle('is-sculpting', interacting)
    if (firstHand) {
      root.style.setProperty('--pinch-x', `${firstHand.x}px`)
      root.style.setProperty('--pinch-y', `${firstHand.y}px`)
    }
    root.dataset.sculpting = interacting ? 'true' : 'false'
    root.dataset.pulling = interacting ? 'true' : 'false'
  }

  function trackHands(now: number) {
    const inputWidth = constrained ? 360 : 480
    const inputHeight = Math.max(1, Math.round(inputWidth * video.videoHeight / video.videoWidth))
    if (handInput.width !== inputWidth || handInput.height !== inputHeight) {
      handInput.width = inputWidth; handInput.height = inputHeight
    }
    handInputContext.setTransform(-1, 0, 0, 1, inputWidth, 0)
    handInputContext.drawImage(video, 0, 0, inputWidth, inputHeight)
    handInputContext.resetTransform()
    if (handDetector) {
      updateHands(handDetector.detectForVideo(handInput, now).landmarks ?? [], now, inputWidth, inputHeight)
      return
    }
    if (!handWorker || handInferenceBusy) return
    handInferenceBusy = true
    const worker = handWorker
    void createImageBitmap(handInput).then((bitmap) => {
      if (!active || !ready || handWorker !== worker) {
        bitmap.close(); handInferenceBusy = false; return
      }
      worker.postMessage({ type: 'frame', bitmap, timestamp: now, width: inputWidth, height: inputHeight }, [bitmap])
    }).catch(() => {
      handInferenceBusy = false
      root.dataset.handTracker = 'worker-error'
    })
  }

  function trackFace(now: number) {
    if (!ready || !detector || video.readyState < 2 || video.currentTime === lastVideoTime) return
    const faceDue = now - lastFaceDetection >= faceDetectionInterval
    const handDue = !!(handDetector || handWorker) && !handInferenceBusy && now - lastHandDetection >= handDetectionInterval
    if (!faceDue && !handDue) return
    let runFace = faceDue
    let runHand = handDue
    // Worker inference can overlap face tracking without blocking paint. The
    // synchronous test/fallback detector retains the collision-free schedule.
    if (!handWorker && faceDue && handDue) {
      const handCritical = hands.size > 0
      const faceOverdue = now - lastFaceDetection >= faceDetectionInterval * 1.65
      if (handCritical && !faceOverdue) runFace = false
      else if (faceOverdue) runHand = false
      else {
        runFace = visionTurn === 'face'
        runHand = !runFace
      }
    }
    if (runFace) lastFaceDetection = now
    if (runHand) lastHandDetection = now
    visionTurn = runFace ? 'hand' : 'face'
    lastVideoTime = video.currentTime
    try {
      if (runHand) trackHands(now)
      if (!runFace) { trackingFailures = 0; root.dataset.trackingFailures = '0'; return }
    } catch {
      trackingFailures += 1; root.dataset.trackingFailures = String(trackingFailures)
      return
    }
    const inputWidth = constrained ? 420 : 560
    const inputHeight = Math.max(1, Math.round(inputWidth * video.videoHeight / video.videoWidth))
    if (input.width !== inputWidth || input.height !== inputHeight) { input.width = inputWidth; input.height = inputHeight }
    inputContext.setTransform(-1, 0, 0, 1, inputWidth, 0); inputContext.drawImage(video, 0, 0, inputWidth, inputHeight); inputContext.resetTransform()
    try {
      const result = detector.detectForVideo(input, now).faceLandmarks[0]
      if (!result) {
        if (pose && now - pose.seen > FACE_TRACKING_GRACE) {
          pose = null; headShape = null; headProfile = null; lastFaceBoundary = []; lastFaceLandmarks = []; motionRoot = null; motionSampleTime = 0; headVelocity = { x: 0, y: 0 }; foamFrameOffset = { x: 0, y: 0 }; foamFrameVelocity = { x: 0, y: 0 }; foamTipSway = { x: 0, y: 0 }; foamTipSwayVelocity = { x: 0, y: 0 }
        }
        trackingFailures = 0; root.dataset.trackingFailures = '0'
        return
      }
      const points = result.map(point => coverPoint(point, inputWidth, inputHeight, width, height))
      lastFaceLandmarks = lastFaceLandmarks.length === points.length
        ? points.map((point, index) => ({ x: mix(lastFaceLandmarks[index].x, point.x, .68), y: mix(lastFaceLandmarks[index].y, point.y, .68) }))
        : points
      lastFaceBoundary = FACE_OVAL_INDICES.map(index => lastFaceLandmarks[index]).filter((point): point is Point => !!point)
      const next = poseFromLandmarks(lastFaceLandmarks, now)
      if (!next) return
      const previousPose = pose
      pose = smoothPose(pose, next)
      if (headShape && previousPose) {
        // Propagate the latest face translation, scale and rotation to the
        // last valid HumanSeg contour immediately. The slower segmentation
        // pass only corrects the silhouette, so visuals never wait for it.
        const move = (point: Point) => faceWorld(faceLocal(point, previousPose), pose!)
        headShape = {
          ...headShape,
          left: headShape.left.map(move), right: headShape.right.map(move),
          top: move(headShape.top), hairline: headShape.hairline.map(move), seen: now,
        }
      }

      if (segmenter && now - lastSegmentation >= segmentationInterval && (!headShape || hands.size === 0)) {
        lastSegmentation = now
        const segmentationWidth = constrained ? 280 : 336
        const segmentationHeight = Math.max(1, Math.round(segmentationWidth * video.videoHeight / video.videoWidth))
        if (segmentationInput.width !== segmentationWidth || segmentationInput.height !== segmentationHeight) {
          segmentationInput.width = segmentationWidth; segmentationInput.height = segmentationHeight
        }
        segmentationInputContext.setTransform(-1, 0, 0, 1, segmentationWidth, 0)
        segmentationInputContext.drawImage(video, 0, 0, segmentationWidth, segmentationHeight)
        segmentationInputContext.resetTransform()
        const segmentation = segmenter.segmentForVideo(segmentationInput, now)
        const confidenceMask = segmentation.confidenceMasks?.[0]
        if (confidenceMask) {
          const segmentedShape = extractHumanHeadShape({
            confidence: confidenceMask.getAsFloat32Array(),
            maskWidth: confidenceMask.width,
            maskHeight: confidenceMask.height,
            landmarks: result,
            inputWidth: segmentationWidth,
            inputHeight: segmentationHeight,
            outputWidth: width,
            outputHeight: height,
            now,
          })
          segmentation.confidenceMasks?.forEach(mask => mask.close())
          if (segmentedShape) {
            headShape = smoothHeadShape(headShape?.source === 'human-seg' ? headShape : null, segmentedShape, .48)
            root.dataset.humanSegExtraction = 'valid'
            const widestHalf = headShape.left.reduce((widest, leftPoint, index) => Math.max(
              widest,
              Math.hypot(headShape!.right[index].x - leftPoint.x, headShape!.right[index].y - leftPoint.y) / 2,
            ), 0)
            const rise = (headShape.top.x - pose.earCenter.x) * pose.up.x + (headShape.top.y - pose.earCenter.y) * pose.up.y
            headProfile = {
              halfWidthRatio: clamp(widestHalf / pose.width, .62, .92),
              riseRatio: clamp(rise / pose.height, .5, .86),
            }
          } else {
            root.dataset.humanSegExtraction = 'retrying'
          }
        } else {
          root.dataset.humanSegExtraction = 'missing-confidence-mask'
        }
      }
      const profile = headProfile ?? DEFAULT_HEAD_PROFILE
      pose.root = {
        x: pose.earCenter.x + pose.up.x * pose.height * profile.riseRatio,
        y: pose.earCenter.y + pose.up.y * pose.height * profile.riseRatio,
      }
      if (motionRoot && nodes.length) {
        const dx = pose.root.x - motionRoot.x
        const dy = pose.root.y - motionRoot.y
        // Carry the entire existing shape forward with the head. The spring
        // solver only has to resolve the remaining relative motion, so the
        // crown cannot lag behind as an unrelated second object.
        const carry = 1
        nodes.forEach(node => { node.x += dx * carry; node.y += dy * carry })
        foamFrameOffset.x -= dx * .31
        foamFrameOffset.y -= dy * .31
        // These are the only impulses that enter the three rig stages. Their
        // stages span root → middle → crown, and are sampled as one smooth
        // curve, so a fast head turn cannot reveal three separate hinges.
        const faceAcross = { x: -pose.up.y, y: pose.up.x }
        const moveAcross = (dx * faceAcross.x + dy * faceAcross.y) / Math.max(1, pose.width)
        const moveAlong = (dx * pose.up.x + dy * pose.up.y) / Math.max(1, pose.height)
        // The stages are deliberately subtle: whole-column inertia comes from
        // foamFrameOffset, while only the crown receives a perceptible sway.
        const stageStrength = [.002, .0035, .0055]
        foamShapeControls.forEach((control, index) => {
          control.across = clamp(control.across - moveAcross * stageStrength[index], -.09, .09)
          control.along = clamp(control.along - moveAlong * stageStrength[index], -.055, .055)
        })
        // Only the upper end gets local motion. Lower and middle sections
        // retain their face-relative shape as a single solid column.
        foamTipSway.x -= dx * .055
        foamTipSway.y -= dy * .055
      }
      if (motionRoot && motionSampleTime) {
        const elapsed = clamp((now - motionSampleTime) / 1000, .02, .2)
        const nextVelocity = {
          x: (pose.root.x - motionRoot.x) / elapsed,
          y: (pose.root.y - motionRoot.y) / elapsed,
        }
        headVelocity.x = mix(headVelocity.x, nextVelocity.x, .58)
        headVelocity.y = mix(headVelocity.y, nextVelocity.y, .58)
      }
      motionRoot = { ...pose.root }; motionSampleTime = now
      root.dataset.headMask = headShape?.source ?? 'human-seg-pending'
      root.dataset.foamBaseWidth = (pose.width * profile.halfWidthRatio * 2).toFixed(1)
      root.dataset.foamTopWidth = (foamRadius(pose, 1) * 2).toFixed(1)
      if (!nodes.length) {
        const totalHeight = foamHeight(pose)
        nodes = createFoamChain(pose.root, pose.up, totalHeight / (NODE_COUNT - 1), NODE_COUNT)
        renderNodes = nodes.map(node => ({ ...node }))
        foamShapeControls = makeFoamShapeControls()
      }
      trackingFailures = 0; root.dataset.trackingFailures = '0'
    } catch {
      trackingFailures += 1; root.dataset.trackingFailures = String(trackingFailures)
      if (trackingFailures >= 3) { releaseCamera(); say('얼굴 인식이 중단됐어요. 카메라를 다시 켜 주세요.', true) }
    }
  }

  function drawCamera() {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.fillStyle = '#d9f1ed'; context.fillRect(0, 0, width, height)
    if (!ready || video.readyState < 2) return
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const drawWidth = video.videoWidth * scale; const drawHeight = video.videoHeight * scale
    context.save(); context.translate(width, 0); context.scale(-1, 1)
    context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    context.restore()
    const shade = context.createLinearGradient(0, 0, 0, height)
    shade.addColorStop(0, 'rgba(22,61,65,.17)'); shade.addColorStop(.42, 'rgba(22,61,65,0)'); shade.addColorStop(1, 'rgba(15,47,50,.13)')
    context.fillStyle = shade; context.fillRect(0, 0, width, height)
  }

  function makeClusterBubbles(unit: number, bubbleCount: number) {
    return Array.from({ length: bubbleCount }, (_, index): ClusterBubble => {
      if (index === 0) return {
        x: 0, y: 0, radius: unit * (1 + flightRandom() * .24), phase: flightRandom() * Math.PI * 2, depth: flightRandom(), core: 1,
      }
      const angle = flightRandom() * Math.PI * 2
      const distance = unit * (.5 + flightRandom() * 1.55)
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        radius: unit * (.44 + flightRandom() * .64),
        phase: flightRandom() * Math.PI * 2,
        depth: flightRandom(),
        core: clamp(1 - distance / (unit * 2.4), .08, .86),
      }
    }).sort((a, b) => a.depth - b.depth)
  }

  function makeClusterSprite(bubbles: ClusterBubble[]): ClusterSprite {
    const padding = 3
    const minimumX = Math.min(...bubbles.map(bubble => bubble.x - bubble.radius)) - padding
    const maximumX = Math.max(...bubbles.map(bubble => bubble.x + bubble.radius)) + padding
    const minimumY = Math.min(...bubbles.map(bubble => bubble.y - bubble.radius)) - padding
    const maximumY = Math.max(...bubbles.map(bubble => bubble.y + bubble.radius)) + padding
    const sprite = document.createElement('canvas')
    sprite.width = Math.max(2, Math.ceil(maximumX - minimumX))
    sprite.height = Math.max(2, Math.ceil(maximumY - minimumY))
    const spriteContext = sprite.getContext('2d', { alpha: true })!
    for (const bubble of bubbles) {
      paintSoapBubble(
        spriteContext,
        bubble.x - minimumX,
        bubble.y - minimumY,
        bubble.radius,
        bubble.depth,
        1,
        bubble.phase,
        bubble.core,
      )
    }
    return { canvas: sprite, originX: -minimumX, originY: -minimumY }
  }

  function retainClusterLimit() {
    // Face-attached foam is deliberate user-created content: never evict it.
    // Only short-lived floating foam has a bounded budget.
    const floatingLimit = constrained ? 20 : 32
    while (flyingClusters.filter(cluster => cluster.mode === 'floating').length > floatingLimit) {
      const removable = flyingClusters.findIndex(cluster => cluster.mode === 'floating')
      if (removable < 0) break
      flyingClusters.splice(removable, 1)
    }
  }

  function createFaceFoam(point: Point, bubbleCount = 18 + Math.floor(flightRandom() * 7), unitScale = 1) {
    if (!pose) return
    const unit = pose.width * (.019 + flightRandom() * .009) * unitScale
    const cluster: FlyingFoamCluster = {
      x: point.x, y: point.y, vx: 0, vy: 0, age: 0, life: 1e6,
      rotation: flightRandom() * Math.PI * 2,
      spin: 0, buoyancy: 0,
      bubbles: makeClusterBubbles(unit, bubbleCount),
      mode: 'attached',
      scale: 1,
      wash: 0,
    }
    cluster.sprite = makeClusterSprite(cluster.bubbles)
    attachClusterAt(cluster, point)
    flyingClusters.push(cluster)
    retainClusterLimit()
  }

  function continueFaceFoamStroke(hand: TrackedHand, stroke: FaceFoamStroke, now: number) {
    if (!pose) return
    const dx = hand.x - stroke.lastPoint.x; const dy = hand.y - stroke.lastPoint.y
    const distance = Math.hypot(dx, dy)
    const spacing = Math.max(15, pose.width * .058)
    if (distance < spacing * .72) return
    const count = Math.min(6, Math.ceil(distance / spacing))
    for (let index = 1; index <= count; index += 1) {
      const amount = index / count
      createFaceFoam({
        x: mix(stroke.lastPoint.x, hand.x, amount),
        y: mix(stroke.lastPoint.y, hand.y, amount),
      }, 12 + Math.floor(flightRandom() * 7))
    }
    stroke.lastPoint = { x: hand.x, y: hand.y }; stroke.lastStamp = now
  }

  function continueFistFoamStroke(hand: TrackedHand, stroke: FistFoamStroke, now: number) {
    if (!pose) return
    const dx = hand.palm.x - stroke.lastPoint.x
    const dy = hand.palm.y - stroke.lastPoint.y
    const distance = Math.hypot(dx, dy)
    const spacing = Math.max(34, pose.width * .16)
    const count = Math.min(4, Math.max(1, Math.ceil(distance / spacing)))
    for (let index = 1; index <= count; index += 1) {
      const amount = index / count
      createFistBloom({
        x: mix(stroke.lastPoint.x, hand.palm.x, amount),
        y: mix(stroke.lastPoint.y, hand.palm.y, amount),
      }, count > 1)
    }
    stroke.lastPoint = { ...hand.palm }
    stroke.lastStamp = now
  }

  function createFistBloom(point: Point, bridge = false) {
    if (!pose) return
    // A fist lays down a large, dense mound made from the very same small
    // soap-bubble units as the HumanSeg scalp mask. Each pulse is deliberately
    // lighter than before because a held fist now emits repeated pulses.
    const clusterCount = bridge ? (constrained ? 2 : 3) : (constrained ? 5 : 6)
    const outerCount = Math.max(1, clusterCount - 1)
    const rotation = flightRandom() * Math.PI * 2
    const minimumSpread = bridge ? .055 : .14
    const maximumSpread = bridge ? .115 : .23
    for (let index = 0; index < clusterCount; index += 1) {
      // Keep one dense core and distribute the rest around it. This covers a
      // visibly larger area without raising the number of rendered clusters.
      const angle = rotation + (index - 1) / outerCount * Math.PI * 2 + (flightRandom() - .5) * .22
      const distance = index ? pose.width * mix(minimumSpread, maximumSpread, .45 + flightRandom() * .55) : 0
      createFaceFoam(
        { x: point.x + Math.cos(angle) * distance, y: point.y + Math.sin(angle) * distance },
        (bridge ? (constrained ? 15 : 17) : (constrained ? 18 : 20)) + Math.floor(flightRandom() * 9),
        bridge ? 1.08 : 1.2,
      )
    }
    if (!bridge) root.dataset.fistBloomSpan = '.660'
    fistBloomCount += clusterCount; root.dataset.fistBlooms = String(fistBloomCount)
  }

  function resolveAttachedTarget(cluster: FlyingFoamCluster, currentPose: FacePose) {
    const landmarkIndex = cluster.attachmentLandmarkIndex
    const landmark = landmarkIndex === undefined ? null : lastFaceLandmarks[landmarkIndex]
    if (landmark && cluster.attachmentLandmarkOffset) {
      const landmarkLocal = faceLocal(landmark, currentPose)
      return faceWorld({
        u: landmarkLocal.u + cluster.attachmentLandmarkOffset.u,
        v: landmarkLocal.v + cluster.attachmentLandmarkOffset.v,
      }, currentPose)
    }
    return cluster.attachment ? faceWorld(cluster.attachment, currentPose) : { x: cluster.x, y: cluster.y }
  }

  function faceAttachmentPointFor(point: Point) {
    if (!pose) return null
    const onFace = lastFaceBoundary.length > 2 && insidePolygon(point, lastFaceBoundary)
    // Landmark outlines can be incomplete for a frame while the detector is
    // recovering. The pose-local core keeps a central facial Pinch from being
    // misclassified as a nearby foam-column pull in that short interval.
    const local = faceLocal(point, pose)
    const insideFaceCore = Math.abs(local.u) < .55 && local.v > -.58 && local.v < .5
    const faceNearest = lastFaceBoundary.length > 2 ? closestPointOnPath(point, lastFaceBoundary) : null
    const nearFaceEdge = !!faceNearest && faceNearest.distance < pose.width * .2
    const onScalpFoam = lastFoamOutline.length > 2 && insidePolygon(point, lastFoamOutline)
    const scalpNearest = lastFoamOutline.length > 2 ? closestPointOnPath(point, lastFoamOutline) : null
    const nearScalpFoam = !!scalpNearest && scalpNearest.distance < pose.width * .12
    const onColumnFoam = lastColumnOutline.length > 2 && insidePolygon(point, lastColumnOutline)
    const columnNearest = lastColumnOutline.length > 2 ? closestPointOnPath(point, lastColumnOutline) : null
    const nearColumnFoam = !!columnNearest && columnNearest.distance < pose.width * .1
    if (!onFace && !insideFaceCore && !nearFaceEdge && !onScalpFoam && !nearScalpFoam && !onColumnFoam && !nearColumnFoam) return null
    if (onFace || insideFaceCore || onScalpFoam || onColumnFoam) return { x: point.x, y: point.y }
    if (nearColumnFoam) return columnNearest!.point
    if (nearScalpFoam) return scalpNearest!.point
    return faceNearest!.point
  }

  function attachClusterAt(cluster: FlyingFoamCluster, point: Point) {
    if (!pose) return false
    cluster.mode = 'attached'
    cluster.x = point.x; cluster.y = point.y
    cluster.attachment = faceLocal(point, pose)
    if (lastFaceLandmarks.length) {
      let landmarkIndex = 0
      let landmarkDistance = Number.POSITIVE_INFINITY
      lastFaceLandmarks.forEach((landmark, index) => {
        const distance = Math.hypot(landmark.x - point.x, landmark.y - point.y)
        if (distance < landmarkDistance) { landmarkIndex = index; landmarkDistance = distance }
      })
      const landmarkLocal = faceLocal(lastFaceLandmarks[landmarkIndex], pose)
      cluster.attachmentLandmarkIndex = landmarkIndex
      cluster.attachmentLandmarkOffset = {
        u: cluster.attachment.u - landmarkLocal.u,
        v: cluster.attachment.v - landmarkLocal.v,
      }
    }
    cluster.attachmentReferenceWidth = pose.width
    cluster.attachmentRotationOffset = cluster.rotation - (Math.atan2(pose.up.y, pose.up.x) + Math.PI / 2)
    cluster.scale = 1
    cluster.vx = 0; cluster.vy = 0; cluster.age = 0; cluster.life = 1e6
    return true
  }

  function updateFlyingFoam(deltaTime: number, hasFreshFace: boolean, now: number) {
    const motionSpeed = pose ? Math.hypot(headVelocity.x, headVelocity.y) / Math.max(1, pose.width) : 0
    // The tall column no longer exists, so head motion must not shed foam
    // from an invisible source. User-made attached clusters remain forever.
    shedAccumulator = Math.max(0, shedAccumulator - deltaTime * .7)
    if (!hasFreshFace) {
      const decay = Math.exp(-deltaTime * 4)
      headVelocity.x *= decay; headVelocity.y *= decay
    }

    for (const cluster of flyingClusters) {
      if (cluster.wash > 0) cluster.wash = Math.min(1, cluster.wash + deltaTime * 2.45)
      if (cluster.mode === 'attached' && cluster.attachment && pose) {
        const target = resolveAttachedTarget(cluster, pose)
        const follow = 1 - Math.exp(-deltaTime * 18)
        cluster.x = mix(cluster.x, target.x, follow); cluster.y = mix(cluster.y, target.y, follow)
        cluster.scale = pose.width / Math.max(1, cluster.attachmentReferenceWidth ?? pose.width)
        cluster.rotation = Math.atan2(pose.up.y, pose.up.x) + Math.PI / 2 + (cluster.attachmentRotationOffset ?? 0)
        continue
      }
      cluster.age += deltaTime
      const drag = Math.exp(-deltaTime * .48)
      cluster.vx *= drag
      cluster.vy = cluster.vy * drag - cluster.buoyancy * deltaTime
      cluster.x += cluster.vx * deltaTime
      cluster.y += cluster.vy * deltaTime
      cluster.rotation += cluster.spin * deltaTime
    }
    const margin = 180
    flyingClusters = flyingClusters.filter(cluster => cluster.wash < .995 && (cluster.mode === 'attached' || (cluster.age < cluster.life
      && cluster.x > -margin && cluster.x < width + margin && cluster.y > -margin && cluster.y < height + margin)))
    // This value is transient and is also useful for the live motion response,
    // so keep it current while throttling the heavier cluster diagnostics.
    root.dataset.headMotionSpeed = motionSpeed.toFixed(2)
    if (now - lastDiagnostics < 180) return
    lastDiagnostics = now
    const attached = flyingClusters.filter(cluster => cluster.mode === 'attached')
    const floatingCount = flyingClusters.filter(cluster => cluster.mode === 'floating').length
    peakFlyingClusters = Math.max(peakFlyingClusters, floatingCount)
    root.dataset.flyingClusters = String(floatingCount)
    root.dataset.peakFlyingClusters = String(peakFlyingClusters)
    root.dataset.grabbedClusters = '0'
    root.dataset.attachedClusters = String(attached.length)
    root.dataset.attachedLandmarks = attached.map(cluster => cluster.attachmentLandmarkIndex ?? -1).join(',')
    const attachedTrackError = pose ? attached.reduce((largest, cluster) => {
      if (!cluster.attachment) return largest
      const target = resolveAttachedTarget(cluster, pose!)
      return Math.max(largest, Math.hypot(cluster.x - target.x, cluster.y - target.y))
    }, 0) : 0
    root.dataset.attachedTrackError = attachedTrackError.toFixed(2)
    root.dataset.attachedCentroidX = attached.length ? (attached.reduce((sum, cluster) => sum + cluster.x, 0) / attached.length).toFixed(2) : '0'
    root.dataset.attachedScale = attached.length ? (attached.reduce((sum, cluster) => sum + cluster.scale, 0) / attached.length).toFixed(3) : '1'
  }

  function drawFlyingFoam(now: number) {
    if (!flyingClusters.length) return
    context.save()
    for (const cluster of flyingClusters) {
      const persistent = cluster.mode === 'attached'
      const fadeIn = persistent ? 1 : clamp(cluster.age / .18, 0, 1)
      const fadeOut = persistent ? 1 : clamp((cluster.life - cluster.age) / 1.15, 0, 1)
      const opacity = fadeIn * fadeOut * (1 - cluster.wash)
      const cosine = Math.cos(cluster.rotation); const sine = Math.sin(cluster.rotation)
      if (persistent && cluster.sprite) {
        context.save()
        context.globalAlpha = opacity
        context.translate(cluster.x, cluster.y)
        context.rotate(cluster.rotation)
        context.scale(cluster.scale, cluster.scale)
        context.drawImage(cluster.sprite.canvas, -cluster.sprite.originX, -cluster.sprite.originY)
        context.restore()
        continue
      }
      for (const bubble of cluster.bubbles) {
        const wobble = Math.sin(now / 520 + bubble.phase) * bubble.radius * .16
        const localX = (bubble.x + Math.cos(bubble.phase) * wobble) * cluster.scale
        const localY = (bubble.y + Math.sin(bubble.phase) * wobble) * cluster.scale
        drawSoapBubble(
          context,
          cluster.x + localX * cosine - localY * sine,
          cluster.y + localX * sine + localY * cosine,
          bubble.radius * cluster.scale,
          bubble.depth,
          opacity,
          bubble.phase + cluster.age,
          bubble.core,
        )
      }
    }
    context.restore()
  }

  function drawFoam(now: number) {
    if (!pose || !headShape || foamOpacity < .01) return
    const currentPose = foamDisplayPose(pose)
    const framePoint = (point: Point) => ({ x: point.x + foamFrameOffset.x, y: point.y + foamFrameOffset.y })
    const left = headShape.left.map(framePoint)
    const right = headShape.right.map(framePoint)
    const hairline = headShape.hairline.map(framePoint)
    if (left.length < 2 || right.length < 2 || hairline.length < 2) return
    const sampleAt = (points: Point[], progress: number) => {
      const scaled = clamp(progress, 0, 1) * (points.length - 1)
      const index = Math.min(points.length - 2, Math.floor(scaled))
      const amount = scaled - index
      const dx = points[index + 1].x - points[index].x
      const dy = points[index + 1].y - points[index].y
      const length = Math.max(1, Math.hypot(dx, dy))
      return {
        point: { x: mix(points[index].x, points[index + 1].x, amount), y: mix(points[index].y, points[index + 1].y, amount) },
        tangent: { x: dx / length, y: dy / length },
      }
    }
    const normalizeVector = (x: number, y: number, fallback: Point) => {
      const length = Math.hypot(x, y)
      return length > .001 ? { x: x / length, y: y / length } : fallback
    }
    // HumanSeg contour: right temple → crown → left temple → forehead. It is
    // also the hit area for the existing hand interactions.
    lastFoamOutline = [...right, ...[...left].reverse(), ...[...hairline].reverse()]
    root.dataset.foamCurveAlignment = '1.000'
    root.dataset.foamSeamError = '0.000'
    root.dataset.foamSeamAlignment = '1.000'
    root.dataset.foamForeheadSmoothness = '1.000'
    const baseRadius = foamBaseRadius(currentPose)
    // The old upward foam column is intentionally not rendered. Keep its
    // internal gesture rig alive below so touch tracking and all other
    // Shampoo interactions retain their existing behaviour.
    lastColumnOutline = []
    root.dataset.foamColumnHeight = '0'
    root.dataset.foamRegion = 'human-seg-scalp'
    root.dataset.foamBoundaryBleed = '.090'
    root.dataset.foamBoundaryResponse = 'normal-tangent'
    root.dataset.foamBoundaryMotion = (baseRadius * .011).toFixed(2)
    defaultFoamTargets = []
    context.save(); context.globalAlpha = foamOpacity
    for (const [index, bubble] of scalpBubbles.entries()) {
      const side = bubble.side
      const level = clamp(bubble.level, 0, 1)
      const scalpLeftSample = sampleAt(left, level)
      const scalpRightSample = sampleAt(right, level)
      const scalpLeft = scalpLeftSample.point
      const scalpRight = scalpRightSample.point
      const edge = { x: mix(scalpLeft.x, scalpRight.x, (side + 1) / 2), y: mix(scalpLeft.y, scalpRight.y, (side + 1) / 2) }
      const hairlineSample = sampleAt(hairline, (1 - clamp(side, -1, 1)) / 2)
      const base = hairlineSample.point
      const fill = Math.pow(level, .72)
      const point = { x: mix(base.x, edge.x, fill), y: mix(base.y, edge.y, fill) }
      // Let the perimeter breathe across the mask: lateral bubbles move out
      // through the HumanSeg edge and low bubbles overlap the forehead line.
      const middle = { x: (scalpLeft.x + scalpRight.x) / 2, y: (scalpLeft.y + scalpRight.y) / 2 }
      const outwardX = edge.x - middle.x; const outwardY = edge.y - middle.y
      const outwardLength = Math.max(1, Math.hypot(outwardX, outwardY))
      const sideEdge = clamp((Math.abs(side) - .62) / .38, 0, 1)
      const hairlineEdge = clamp((.22 - level) / .22, 0, 1)
      const crownEdge = clamp((level - .82) / .18, 0, 1)
      const bleed = baseRadius * bubble.bleed
      point.x += outwardX / outwardLength * bleed * sideEdge + currentPose.up.x * bleed * (crownEdge - hairlineEdge)
      point.y += outwardY / outwardLength * bleed * sideEdge + currentPose.up.y * bleed * (crownEdge - hairlineEdge)

      // Each default bubble samples the nearby HumanSeg contour every frame.
      // Its tiny drift follows that contour's normal and tangent instead of a
      // screen-space wobble, so irregular hair edges produce matching motion.
      const sideBoundary = side < 0 ? scalpLeftSample : scalpRightSample
      const sideNormal = normalizeVector(sideBoundary.point.x - middle.x, sideBoundary.point.y - middle.y, {
        x: side < 0 ? currentPose.up.y : -currentPose.up.y,
        y: side < 0 ? -currentPose.up.x : currentPose.up.x,
      })
      const sideWeight = Math.exp(-Math.max(0, 1 - Math.min(1, Math.abs(side))) * 4.6)
      const hairlineWeight = Math.exp(-level * 5)
      const crownWeight = Math.exp(-(1 - level) * 5)
      const across = { x: -currentPose.up.y, y: currentPose.up.x }
      const normal = normalizeVector(
        sideNormal.x * sideWeight - currentPose.up.x * hairlineWeight + currentPose.up.x * crownWeight,
        sideNormal.y * sideWeight - currentPose.up.y * hairlineWeight + currentPose.up.y * crownWeight,
        currentPose.up,
      )
      const tangent = normalizeVector(
        sideBoundary.tangent.x * sideWeight + hairlineSample.tangent.x * hairlineWeight + across.x * crownWeight,
        sideBoundary.tangent.y * sideWeight + hairlineSample.tangent.y * hairlineWeight + across.y * crownWeight,
        across,
      )
      const proximity = clamp(Math.max(sideWeight, hairlineWeight, crownWeight), .12, 1)
      const normalDrift = Math.sin(now / (900 + bubble.depth * 320) + bubble.phase) * baseRadius * (.0025 + proximity * .0045)
      const tangentDrift = Math.sin(now / (1370 + bubble.depth * 410) + bubble.phase * 1.43) * baseRadius * (.0015 + proximity * .0025)
      point.x += normal.x * normalDrift + tangent.x * tangentDrift
      point.y += normal.y * normalDrift + tangent.y * tangentDrift
      const sideDistance = clamp(Math.abs(side), 0, 1)
      const core = Math.pow(1 - sideDistance, .58)
      const radius = Math.max(1.2, baseRadius * bubble.size * (1 - sideDistance * .1))
      const wash = scalpBubbleWash[index] ?? 0
      defaultFoamTargets.push({ index, x: point.x, y: point.y, radius })
      drawSoapBubble(context, point.x, point.y, radius, bubble.depth, foamOpacity * baseFoamOpacity * (1 - wash) * (.3 + core * .7), bubble.phase, core)
    }
    context.restore()
  }

  function applyHandFoamTouch(deltaTime: number, now: number) {
    if (!pose || nodes.length < 2 || lastFoamOutline.length < 3) {
      root.dataset.touchDeforming = 'false'; root.dataset.foamTouchForce = '0'
      return
    }
    let strongestForce = 0
    for (const hand of hands.values()) {
      if (hand.pinching || now - hand.seen > HAND_TRACKING_GRACE) continue
      let bestContact: { nodeIndex: number; point: Point; influence: number } | null = null
      for (const point of hand.touchPoints) {
        if (!insidePolygon(point, lastFoamOutline) && closestPointOnPath(point, lastFoamOutline).distance > hand.touchRadius) continue
        let nodeIndex = 0
        let nodeDistance = Number.POSITIVE_INFINITY
        const visualNodes = renderNodes.length === nodes.length ? renderNodes : nodes
        visualNodes.forEach((node, index) => {
          const distance = Math.hypot(point.x - node.x, point.y - node.y)
          if (distance < nodeDistance) { nodeIndex = index; nodeDistance = distance }
        })
        const progress = nodeIndex / Math.max(1, nodes.length - 1)
        const reach = foamRadius(pose, progress) + hand.touchRadius
        const influence = clamp(1 - nodeDistance / Math.max(1, reach), 0, 1)
        if (influence > (bestContact?.influence ?? 0)) bestContact = { nodeIndex, point, influence }
      }
      if (!bestContact || bestContact.influence <= 0) continue
      const center = nodes[bestContact.nodeIndex]
      const physicalTouch = { x: bestContact.point.x - foamFrameOffset.x, y: bestContact.point.y - foamFrameOffset.y }
      const fromTouchX = center.x - physicalTouch.x
      const fromTouchY = center.y - physicalTouch.y
      const fromTouchLength = Math.max(1, Math.hypot(fromTouchX, fromTouchY))
      const normalX = fromTouchX / fromTouchLength
      const normalY = fromTouchY / fromTouchLength
      const speedFade = clamp(1 - (now - hand.seen) / HAND_TRACKING_GRACE, 0, 1)
      const dragX = clamp(hand.vx * deltaTime * .48, -pose.width * .055, pose.width * .055)
      const dragY = clamp(hand.vy * deltaTime * .48, -pose.width * .055, pose.width * .055)
      for (let index = 1; index < nodes.length; index += 1) {
        const distance = Math.abs(index - bestContact.nodeIndex)
        if (distance > 2.4) continue
        const spread = Math.exp(-distance * distance * .72)
        const mobility = .22 + index / (nodes.length - 1) * .78
        const amount = bestContact.influence * spread * mobility * speedFade
        const push = pose.width * .0065 * amount
        nodes[index].x += dragX * amount + normalX * push
        nodes[index].y += dragY * amount + normalY * push
        nodes[index].vx += (dragX * 5 + normalX * push * 9) * amount
        nodes[index].vy += (dragY * 5 + normalY * push * 9) * amount
      }
      // The column is no longer visible, but its touch response remains part
      // of Shampoo: transfer the same damped impulse to the scalp layer.
      // This keeps an open palm/fingertip push legible on the new foam shape.
      const scalpPush = pose.width * .0065 * bestContact.influence
      foamFrameVelocity.x += dragX * 2.2 * bestContact.influence + normalX * scalpPush * 4
      foamFrameVelocity.y += dragY * 2.2 * bestContact.influence + normalY * scalpPush * 4
      strongestForce = Math.max(strongestForce, bestContact.influence * (Math.hypot(dragX, dragY) + pose.width * .0065))
    }
    root.dataset.touchDeforming = strongestForce > .08 ? 'true' : 'false'
    root.dataset.foamTouchForce = strongestForce.toFixed(2)
  }

  function foamDisplayPose(currentPose: FacePose): FacePose {
    const offset = foamFrameOffset
    return {
      ...currentPose,
      root: { x: currentPose.root.x + offset.x, y: currentPose.root.y + offset.y },
      forehead: { x: currentPose.forehead.x + offset.x, y: currentPose.forehead.y + offset.y },
      earCenter: { x: currentPose.earCenter.x + offset.x, y: currentPose.earCenter.y + offset.y },
    }
  }

  function stepFoamFrame(deltaTime: number) {
    // Critically damped return: visible inertia, but no spring reversal or
    // high-frequency wobble at the forehead/cap connection.
    const stiffness = 66
    const damping = 16.5
    foamFrameVelocity.x += (-foamFrameOffset.x * stiffness - foamFrameVelocity.x * damping) * deltaTime
    foamFrameVelocity.y += (-foamFrameOffset.y * stiffness - foamFrameVelocity.y * damping) * deltaTime
    foamFrameOffset.x += foamFrameVelocity.x * deltaTime
    foamFrameOffset.y += foamFrameVelocity.y * deltaTime
  }

  function stepFoamTipSway(deltaTime: number) {
    // A short, well-damped wobble belongs only at the tip. It is intentionally
    // not propagated into the middle of the column.
    const stiffness = 52
    const damping = 15
    foamTipSwayVelocity.x += (-foamTipSway.x * stiffness - foamTipSwayVelocity.x * damping) * deltaTime
    foamTipSwayVelocity.y += (-foamTipSway.y * stiffness - foamTipSwayVelocity.y * damping) * deltaTime
    foamTipSway.x += foamTipSwayVelocity.x * deltaTime
    foamTipSway.y += foamTipSwayVelocity.y * deltaTime
  }

  function stepFoamRig(deltaTime: number) {
    // Three whole-column stages settle together. This is damping of a single
    // continuous spline, not three visible spring joints.
    const decay = Math.exp(-deltaTime * 6.8)
    foamShapeControls.forEach(control => {
      control.across *= decay
      control.along *= decay
    })
  }

  function shapeOffsetAt(progress: number): FoamRestOffset {
    const anchors = [{ progress: 0, across: 0, along: 0 }, ...foamShapeControls]
    const safeProgress = clamp(progress, 0, 1)
    const segment = Math.min(anchors.length - 2, anchors.findIndex((anchor, index) => index > 0 && safeProgress <= anchor.progress) - 1)
    const index = Math.max(0, segment)
    const first = anchors[index]
    const second = anchors[index + 1]
    const amount = clamp((safeProgress - first.progress) / Math.max(.001, second.progress - first.progress), 0, 1)
    // Smoothstep has a zero tangent at all three control stages, so they are
    // mathematical control points only — never visible graphic joints.
    const eased = amount * amount * (3 - 2 * amount)
    return { across: mix(first.across, second.across, eased), along: mix(first.along, second.along, eased) }
  }

  function restingFoamPoint(progress: number, currentPose: FacePose, spacing: number) {
    const offset = shapeOffsetAt(progress)
    const across = { x: -currentPose.up.y, y: currentPose.up.x }
    const index = progress * (nodes.length - 1)
    return {
      x: currentPose.root.x + currentPose.up.x * spacing * index + across.x * offset.across * currentPose.width + currentPose.up.x * offset.along * currentPose.height,
      y: currentPose.root.y + currentPose.up.y * spacing * index + across.y * offset.across * currentPose.width + currentPose.up.y * offset.along * currentPose.height,
    }
  }

  function settleFoamToRest(currentPose: FacePose, spacing: number) {
    nodes.forEach((node, index) => {
      const progress = index / Math.max(1, nodes.length - 1)
      const point = restingFoamPoint(progress, currentPose, spacing)
      node.x = point.x
      node.y = point.y
      node.vx = 0; node.vy = 0
    })
  }

  function update(deltaTime: number, now: number) {
    const hasFreshFace = !!pose && now - pose.seen < FACE_TRACKING_GRACE
    foamOpacity += ((hasFreshFace ? 1 : 0) - foamOpacity) * (1 - Math.exp(-deltaTime * (hasFreshFace ? 5 : 3.5)))
    if (pose && nodes.length) {
      stepFoamFrame(deltaTime)
      stepFoamTipSway(deltaTime)
      stepFoamRig(deltaTime)
      const totalHeight = foamHeight(pose)
      const spacing = totalHeight / (NODE_COUNT - 1)
      settleFoamToRest(pose, spacing)
      applyHandFoamTouch(deltaTime, now)
      if (renderNodes.length !== nodes.length) renderNodes = nodes.map(node => ({ ...node }))
      let maximumRenderStep = 0
      const visualPose = foamDisplayPose(pose)
      renderNodes.forEach((node, index) => {
        if (index === 0) {
          node.x = visualPose.root.x; node.y = visualPose.root.y; node.vx = 0; node.vy = 0
          return
        }
        const progress = index / Math.max(1, renderNodes.length - 1)
        const tipWeight = Math.pow(progress, 5)
        const targetX = nodes[index].x + foamFrameOffset.x + foamTipSway.x * tipWeight
        const targetY = nodes[index].y + foamFrameOffset.y + foamTipSway.y * tipWeight
        // Every stage resolves in the same frame. The global foam frame gives
        // inertia to the full silhouette; only the very tip gets extra sway.
        maximumRenderStep = Math.max(maximumRenderStep, Math.hypot(targetX - node.x, targetY - node.y))
        node.x = targetX; node.y = targetY
        node.vx = 0; node.vy = 0
      })
      root.dataset.foamRenderStepRatio = (maximumRenderStep / Math.max(1, pose.width)).toFixed(4)
      root.dataset.foamRootError = Math.hypot(nodes[0].x - pose.root.x, nodes[0].y - pose.root.y).toFixed(2)
      const crown = nodes.at(-1)!
      const idealCrown = { x: pose.root.x + pose.up.x * totalHeight, y: pose.root.y + pose.up.y * totalHeight }
      const bend = Math.hypot(crown.x - idealCrown.x, crown.y - idealCrown.y)
      peakFoamBend = Math.max(peakFoamBend, bend)
      root.dataset.foamBend = bend.toFixed(1)
      root.dataset.foamPeakBend = peakFoamBend.toFixed(1)
    }
    updateFlyingFoam(deltaTime, hasFreshFace, now)
    updateShower(deltaTime, now, hasFreshFace)
    updateRain(deltaTime, now)
    root.classList.toggle('has-face', hasFreshFace)
    root.dataset.tracking = hasFreshFace ? 'face' : 'searching'
    mode.textContent = showerPhase === 'raining' || showerPhase === 'clearing'
      ? 'RINSING'
      : showerPhase === 'grabbing'
        ? 'SHOWER GRAB'
        : [...hands.values()].some(hand => hand.fist) ? 'FOAM BLOOM' : faceFoamStrokes.size ? 'FOAM PAINT' : hasFreshFace ? 'FOAM FOLLOW' : 'FIND YOUR FACE'
  }

  function animate(now: number) {
    if (!active || paused || document.hidden) return
    frame = requestAnimationFrame(animate)
    if (now - lastFrame < frameInterval) return
    const deltaTime = Math.min((now - (lastFrame || now)) / 1000, .05); lastFrame = now
    trackFace(now); update(deltaTime, now); drawCamera(); drawFoam(now); drawFlyingFoam(now); drawRain()
  }

  function releaseCamera() {
    ++generation; starting = false; ready = false
    stream?.getTracks().forEach(track => track.stop()); stream = null
    video.pause(); video.srcObject = null
    detector?.close(); detector = null
    handDetector?.close(); handDetector = null
    handWorker?.postMessage({ type: 'close' }); handWorker = null; handInferenceBusy = false
    segmenter?.close(); segmenter = null; trackerPromise = null
    pose = null; headShape = null; headProfile = null; hands = new Map(); lastFoamOutline = []; lastColumnOutline = []; lastFaceBoundary = []; lastFaceLandmarks = []; nodes = []; renderNodes = []; foamOpacity = 0; baseFoamOpacity = 1; baseFoamTarget = 1; scalpBubbleWash = []; defaultFoamTargets = []; rainDrops = []; showerPhase = 'hidden'; showerPhaseStartedAt = 0; showerArrival = 0; showerPull = 0; showerGrabbedHand = null; showerGrabStartY = 0; showerRainElapsed = 0; showerRainAccumulator = 0; showerRebuildAt = 0; showerClearStarted = false; syncShowerVisual()
    flyingClusters = []; faceFoamStrokes = new Map(); fistFoamStrokes = new Map(); foamShapeControls = makeFoamShapeControls(); fistBloomCount = 0; motionRoot = null; motionSampleTime = 0; headVelocity = { x: 0, y: 0 }; foamFrameOffset = { x: 0, y: 0 }; foamFrameVelocity = { x: 0, y: 0 }; foamTipSway = { x: 0, y: 0 }; foamTipSwayVelocity = { x: 0, y: 0 }; shedAccumulator = 0; peakFoamBend = 0; peakFlyingClusters = 0; lastDiagnostics = 0
    gate.hidden = false; root.classList.remove('is-ready', 'has-face', 'has-hand', 'is-pinching', 'is-sculpting', 'is-shower-visible', 'is-shower-grabbed'); root.dataset.tracking = 'idle'; delete root.dataset.foamBend; delete root.dataset.foamPeakBend; delete root.dataset.shower; delete root.dataset.rainDrops; delete root.dataset.foamRinse
    delete root.dataset.humanSeg; delete root.dataset.humanSegMask; delete root.dataset.humanSegLabel; delete root.dataset.humanSegExtraction; delete root.dataset.handTracker; delete root.dataset.headMask; delete root.dataset.foamBaseWidth; delete root.dataset.foamTopWidth; delete root.dataset.foamColumnHeight; delete root.dataset.foamRegion; delete root.dataset.foamBoundaryBleed; delete root.dataset.foamBoundaryResponse; delete root.dataset.foamBoundaryMotion; delete root.dataset.handCount; delete root.dataset.foamRootError; delete root.dataset.foamSeamError; delete root.dataset.foamSeamAlignment; delete root.dataset.foamCurveAlignment; delete root.dataset.foamForeheadSmoothness; delete root.dataset.foamRenderStepRatio; delete root.dataset.touchDeforming; delete root.dataset.foamTouchForce; delete root.dataset.pulling; delete root.dataset.sculpting; delete root.dataset.fistBlooms; delete root.dataset.fistBloomSpan; delete root.dataset.headMotionSpeed; delete root.dataset.flyingClusters; delete root.dataset.peakFlyingClusters; delete root.dataset.grabbedClusters; delete root.dataset.attachedClusters; delete root.dataset.attachedLandmarks; delete root.dataset.attachedTrackError; delete root.dataset.attachedCentroidX; delete root.dataset.attachedScale; delete root.dataset.trackingFailures
    root.style.removeProperty('--pinch-x'); root.style.removeProperty('--pinch-y')
    live.textContent = 'CAMERA OFF'; mode.textContent = 'WAITING'
    startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>'
  }

  startButton.addEventListener('click', () => { void enableCamera() })
  q<HTMLButtonElement>('.shampoo__refresh').addEventListener('click', () => {
    const seed = performance.now()
    scalpBubbles = makeScalpBubbles(seed); flyingClusters = []; hands = new Map(); faceFoamStrokes = new Map(); fistFoamStrokes = new Map(); foamShapeControls = makeFoamShapeControls(); fistBloomCount = 0; foamFrameOffset = { x: 0, y: 0 }; foamFrameVelocity = { x: 0, y: 0 }; foamTipSway = { x: 0, y: 0 }; foamTipSwayVelocity = { x: 0, y: 0 }; shedAccumulator = 0; peakFoamBend = 0; peakFlyingClusters = 0; baseFoamOpacity = 1; baseFoamTarget = 1; scalpBubbleWash = []; defaultFoamTargets = []; rainDrops = []; showerPhase = 'hidden'; showerArrival = 0; showerPull = 0; showerGrabbedHand = null; showerRainElapsed = 0; showerRainAccumulator = 0; showerRebuildAt = 0; showerClearStarted = false; root.classList.remove('is-shower-visible', 'is-shower-grabbed'); delete root.dataset.shower; delete root.dataset.rainDrops; delete root.dataset.foamRinse; syncShowerVisual()
    root.dataset.pulling = 'false'; root.dataset.sculpting = 'false'; root.classList.remove('is-sculpting')
    say('새로운 거품을 만들었어요.')
  })
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) { releaseCamera(); cancelAnimationFrame(frame) }
    else if (active && !paused) { lastFrame = 0; frame = requestAnimationFrame(animate) }
  })
  window.addEventListener('pagehide', () => { if (active) { releaseCamera(); cancelAnimationFrame(frame) } })

  return {
    captureFrame: () => canvas,
    start() {
      if (active) return
      active = true; paused = false; resize(); lastFrame = 0; frame = requestAnimationFrame(animate)
    },
    stop() {
      if (!active) return
      active = false; paused = false; releaseCamera(); cancelAnimationFrame(frame); clearTimeout(statusTimer); status.textContent = ''
    },
    setPaused(value: boolean) {
      paused = value
      if (paused) { cancelAnimationFrame(frame); video.pause() }
      else if (active) { void video.play().catch(() => {}); lastFrame = 0; frame = requestAnimationFrame(animate) }
    },
  }
}
