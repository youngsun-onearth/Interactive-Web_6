import './doodle-face.css'
import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'

type Side = 0 | 1
type Phase = 'lobby' | 'waiting' | 'countdown' | 'swapping' | 'playing' | 'result'
type Point = { x: number; y: number }
type FacePoint = Point & { z?: number }
type Anchor = { landmark: number; dx: number; dy: number }
type PaintPoint = Anchor & { pressure: number }
type Stroke = { id: string; color: string; width: number; points: PaintPoint[] }

const BASE = import.meta.env.BASE_URL
const GAME_SECONDS = 60
const COUNTDOWN_SECONDS = 5
const SWAP_DURATION_MS = 850
const READY_HOLD_MS = 650
const RESULT_NOTICE_SECONDS = 2.4
const RESULT_VIEW_SECONDS = 10
const palette = ['#ff4d6d', '#ff8a3d', '#ffd43b', '#61d36f', '#38c7d9', '#4b8cff', '#9b6dff', '#f15bb5', '#ffffff', '#171717']
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const constrainedDevice = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
const trackingWidth = constrainedDevice ? 360 : 480
const faceInterval = constrainedDevice ? 86 : 58
const handInterval = constrainedDevice ? 64 : 42
const HAND_LOST_GRACE_MS = 220
const PINCH_RELEASE_GRACE_MS = 110
const overlayInterval = 1000 / (constrainedDevice ? 20 : 30)
const cameraInterval = 1000 / (constrainedDevice ? 20 : 24)
const canvasPixelRatio = constrainedDevice ? 1 : 1.5
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const formatClock = (totalSeconds: number) => `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`

function faceScale(face: FacePoint[]) {
  let minX = 1; let maxX = 0; let minY = 1; let maxY = 0
  for (const point of face) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }
  const leftEye = face[33]; const rightEye = face[263]
  const angle = leftEye && rightEye ? Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) : 0
  return { minX, maxX, minY, maxY, width: Math.max(.001, maxX - minX), height: Math.max(.001, maxY - minY), angle }
}

type FaceMetrics = ReturnType<typeof faceScale>

function smoothFace(previous: FacePoint[], next: FacePoint[], amount = .84) {
  if (previous.length !== next.length) return next.map(point => ({ ...point }))
  return next.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * amount,
    y: previous[index].y + (point.y - previous[index].y) * amount,
    z: point.z,
  }))
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function predictFace(current: FacePoint[], previous: FacePoint[], currentAt: number, previousAt: number, now: number) {
  if (!current.length || current.length !== previous.length) return current
  const interval = currentAt - previousAt; const age = now - currentAt
  if (interval < 20 || age <= 0 || age > 220) return current
  const amount = clamp(age / interval * .82, 0, 1.08)
  const currentScale = faceScale(current); const previousScale = faceScale(previous)
  const center = { x: (currentScale.minX + currentScale.maxX) / 2, y: (currentScale.minY + currentScale.maxY) / 2 }
  const previousCenter = { x: (previousScale.minX + previousScale.maxX) / 2, y: (previousScale.minY + previousScale.maxY) / 2 }
  const translateX = (center.x - previousCenter.x) * amount
  const translateY = (center.y - previousCenter.y) * amount
  const scaleX = clamp(1 + (currentScale.width / previousScale.width - 1) * amount, .9, 1.1)
  const scaleY = clamp(1 + (currentScale.height / previousScale.height - 1) * amount, .9, 1.1)
  const rotation = angleDelta(previousScale.angle, currentScale.angle) * amount
  const cosine = Math.cos(rotation); const sine = Math.sin(rotation)
  return current.map(point => {
    const x = (point.x - center.x) * scaleX; const y = (point.y - center.y) * scaleY
    return { x: center.x + translateX + x * cosine - y * sine, y: center.y + translateY + x * sine + y * cosine, z: point.z }
  })
}

function isInsideFace(point: Point, face: FacePoint[]) {
  if (!face.length) return false
  const bounds = faceScale(face)
  const cx = (bounds.minX + bounds.maxX) / 2; const cy = (bounds.minY + bounds.maxY) / 2
  const nx = (point.x - cx) / (bounds.width * .58); const ny = (point.y - cy) / (bounds.height * .62)
  return nx * nx + ny * ny <= 1
}

function makeAnchor(point: Point, face: FacePoint[]): Anchor {
  const scale = faceScale(face)
  let landmark = 0; let nearest = Number.POSITIVE_INFINITY
  face.forEach((candidate, index) => {
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
    if (distance < nearest) { nearest = distance; landmark = index }
  })
  const offsetX = point.x - face[landmark].x; const offsetY = point.y - face[landmark].y
  const cosine = Math.cos(scale.angle); const sine = Math.sin(scale.angle)
  return { landmark, dx: (offsetX * cosine + offsetY * sine) / scale.width, dy: (-offsetX * sine + offsetY * cosine) / scale.height }
}

function resolveAnchor(anchor: Anchor, face: FacePoint[], scale: FaceMetrics = faceScale(face)): Point | null {
  const landmark = face[anchor.landmark]
  if (!landmark) return null
  const offsetX = anchor.dx * scale.width; const offsetY = anchor.dy * scale.height
  const cosine = Math.cos(scale.angle); const sine = Math.sin(scale.angle)
  return { x: landmark.x + offsetX * cosine - offsetY * sine, y: landmark.y + offsetX * sine + offsetY * cosine }
}

function screenCenter(face: FacePoint[]) {
  const bounds = faceScale(face)
  return 1 - (bounds.minX + bounds.maxX) / 2
}

function cropFace(face: FacePoint[], side: Side) {
  return face.map(point => ({
    x: side === 0 ? 2 * (1 - point.x) : 1 - 2 * point.x,
    y: point.y,
    z: point.z,
  }))
}

export function createDoodleFace(root: HTMLElement) {
  root.innerHTML = `
    <div class="doodle-face__lobby">
      <p class="doodle-face__kicker">CAMERA DRAWING GAME / 10</p>
      <h2>DoodleFace</h2>
      <p>한 카메라 앞에 두 사람이 나란히 서서<br>60초 동안 서로의 얼굴을 꾸며 보세요.</p>
      <div class="doodle-face__actions">
        <button class="doodle-face__create" type="button">2인 게임 시작 <span>＋</span></button>
        <button class="doodle-face__join" type="button">게임 방법 <span>?</span></button>
      </div>
      <small>각자 화면의 절반 안에 얼굴이 보이면 자동으로 시작합니다.</small>
    </div>
    <div class="doodle-face__room" hidden>
      <header class="doodle-face__hud">
        <div><span class="doodle-face__live-dot"></span><strong>DOODLEFACE</strong></div>
        <p class="doodle-face__room-code">LOCAL · 2 PLAYERS</p>
        <p class="doodle-face__timer">01:00</p>
      </header>
      <div class="doodle-face__feeds">
        ${([0, 1] as Side[]).map(side => `
          <article class="doodle-face__feed doodle-face__feed--${side === 0 ? 'left' : 'right'}" data-panel="${side}">
            <canvas class="doodle-face__camera doodle-face__camera--${side === 0 ? 'left' : 'right'}"></canvas>
            <canvas class="doodle-face__canvas doodle-face__canvas--${side === 0 ? 'local' : 'remote'}"></canvas>
            <span class="doodle-face__label">PLAYER ${side + 1} · 얼굴을 맞춰 주세요</span>
            <div class="doodle-face__peer-wait"><span></span><strong>WAITING</strong><small>PLAYER ${side + 1} 얼굴 인식 대기 중</small></div>
            <div class="doodle-face__palette" aria-label="PLAYER ${side + 1} 펜 색상 선택">
              ${palette.map((color, index) => `<button type="button" data-side="${side}" data-color="${color}" aria-label="색상 ${index + 1}" style="--swatch:${color}"${index === 0 ? ' class="is-active"' : ''}></button>`).join('')}
            </div>
          </article>
        `).join('')}
        <div class="doodle-face__swap-stage" aria-hidden="true" hidden>
          <canvas class="doodle-face__swap-frame doodle-face__swap-frame--left"></canvas>
          <canvas class="doodle-face__swap-frame doodle-face__swap-frame--right"></canvas>
        </div>
      </div>
      <div class="doodle-face__center-message" hidden>
        <p class="doodle-face__message-kicker"></p>
        <strong class="doodle-face__message-main"></strong>
        <span class="doodle-face__message-sub"></span>
      </div>
      <footer class="doodle-face__footer">
        <p>얼굴 안에서 그리기 시작 · 핀치를 유지하면 얼굴 밖까지 이어 그리기</p>
        <button class="doodle-face__leave" type="button">나가기 ×</button>
      </footer>
    </div>
    <video class="doodle-face__source-video" muted autoplay playsinline hidden></video>
    <p class="doodle-face__status" role="status" aria-live="polite"></p>
  `

  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const lobby = q<HTMLDivElement>('.doodle-face__lobby')
  const room = q<HTMLDivElement>('.doodle-face__room')
  const startButton = q<HTMLButtonElement>('.doodle-face__create')
  const helpButton = q<HTMLButtonElement>('.doodle-face__join')
  const leaveButton = q<HTMLButtonElement>('.doodle-face__leave')
  const status = q<HTMLParagraphElement>('.doodle-face__status')
  const timer = q<HTMLParagraphElement>('.doodle-face__timer')
  const centerMessage = q<HTMLDivElement>('.doodle-face__center-message')
  const messageKicker = q<HTMLParagraphElement>('.doodle-face__message-kicker')
  const messageMain = q<HTMLElement>('.doodle-face__message-main')
  const messageSub = q<HTMLElement>('.doodle-face__message-sub')
  const sourceVideo = q<HTMLVideoElement>('.doodle-face__source-video')
  const feeds = [q<HTMLElement>('.doodle-face__feed--left'), q<HTMLElement>('.doodle-face__feed--right')] as const
  const cameraCanvases = [q<HTMLCanvasElement>('.doodle-face__camera--left'), q<HTMLCanvasElement>('.doodle-face__camera--right')] as const
  const overlayCanvases = [q<HTMLCanvasElement>('.doodle-face__canvas--local'), q<HTMLCanvasElement>('.doodle-face__canvas--remote')] as const
  const swapStage = q<HTMLDivElement>('.doodle-face__swap-stage')
  const swapCanvases = [q<HTMLCanvasElement>('.doodle-face__swap-frame--left'), q<HTMLCanvasElement>('.doodle-face__swap-frame--right')] as const
  const cameraContexts = cameraCanvases.map(canvas => canvas.getContext('2d', { alpha: false })!)
  const overlayContexts = overlayCanvases.map(canvas => canvas.getContext('2d')!)
  const waits = [...root.querySelectorAll<HTMLDivElement>('.doodle-face__peer-wait')]
  const labels = [...root.querySelectorAll<HTMLElement>('.doodle-face__label')]
  const swatches = [...root.querySelectorAll<HTMLButtonElement>('.doodle-face__palette button')]
  const captureCanvas = document.createElement('canvas'); const captureContext = captureCanvas.getContext('2d')!
  const trackingInput = document.createElement('canvas'); const trackingContext = trackingInput.getContext('2d', { alpha: false })!

  let active = false; let paused = false; let generation = 0; let animationFrame = 0
  let phase: Phase = 'lobby'; let stream: MediaStream | null = null
  let faceDetector: FaceLandmarker | null = null; let handDetector: HandLandmarker | null = null; let trackerPromise: Promise<void> | null = null
  let faces: [FacePoint[], FacePoint[]] = [[], []]; let previousFaces: [FacePoint[], FacePoint[]] = [[], []]
  let faceUpdatedAt: [number, number] = [0, 0]; let previousFaceUpdatedAt: [number, number] = [0, 0]
  let faceLastSeenAt: [number, number] = [0, 0]
  let pens: [Point | null, Point | null] = [null, null]; let pinching: [boolean, boolean] = [false, false]
  let wasPinching: [boolean, boolean] = [false, false]; let palettePinch: [boolean, boolean] = [false, false]
  let handLastSeenAt: [number, number] = [0, 0]; let pinchReleaseStartedAt: [number, number] = [0, 0]
  let colors: [string, string] = [palette[0], palette[0]]; let activeStrokeIds: [string, string] = ['', '']
  let strokesByFace: [Stroke[], Stroke[]] = [[], []]
  let lastFaceDetection = 0; let lastHandDetection = 0; let lastVideoTime = -1; let lastInference: 'face' | 'hand' = 'hand'
  let handRunsSinceFace = 0
  let lastCameraRender = 0; let lastOverlayRender = 0; let inferenceLoad = 1
  let readySince = 0; let startsAt = 0; let swapEndsAt = 0; let endsAt = 0; let resultNoticeEndsAt = 0; let resultEndsAt = 0
  let statusTimer = 0; let canvasesDirty = true

  function say(message: string, persistent = false) {
    clearTimeout(statusTimer); status.textContent = message
    if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '' }, 4500)
  }

  function setPhase(next: Phase) {
    phase = next; root.dataset.phase = next; root.classList.toggle('is-playing', next === 'playing'); canvasesDirty = true
    root.dataset.swapped = String(next === 'swapping' || next === 'playing' || next === 'result')
  }

  function showCenter(kicker: string, main: string, sub: string) {
    centerMessage.hidden = false; messageKicker.textContent = kicker; messageMain.textContent = main; messageSub.textContent = sub
  }

  function showLobby(message = '') {
    setPhase('lobby'); lobby.hidden = false; room.hidden = true; centerMessage.hidden = true
    startButton.disabled = false; helpButton.disabled = false
    if (message) say(message)
  }

  function showRoom() {
    lobby.hidden = true; room.hidden = false; timer.textContent = '01:00'
  }

  async function loadTrackers() {
    if (faceDetector && handDetector) return
    if (!trackerPromise) trackerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import('@mediapipe/tasks-vision')
      const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
      const faceOptions = {
        runningMode: 'VIDEO' as const, numFaces: 2, minFaceDetectionConfidence: .48,
        minFacePresenceConfidence: .48, minTrackingConfidence: .48,
        baseOptions: { modelAssetPath: `${BASE}mediapipe/face_landmarker.task`, delegate: 'GPU' as const },
      }
      const handOptions = {
        runningMode: 'VIDEO' as const, numHands: 2, minHandDetectionConfidence: .45,
        minHandPresenceConfidence: .45, minTrackingConfidence: .45,
        baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'GPU' as const },
      }
      try { faceDetector = await FaceLandmarker.createFromOptions(files, faceOptions) }
      catch { faceDetector = await FaceLandmarker.createFromOptions(files, { ...faceOptions, baseOptions: { ...faceOptions.baseOptions, delegate: 'CPU' } }) }
      try { handDetector = await HandLandmarker.createFromOptions(files, handOptions) }
      catch { handDetector = await HandLandmarker.createFromOptions(files, { ...handOptions, baseOptions: { ...handOptions.baseOptions, delegate: 'CPU' } }) }
    })().catch(error => { trackerPromise = null; throw error })
    return trackerPromise
  }

  async function openCamera(session: number) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('secure-context')
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user', width: { ideal: constrainedDevice ? 960 : 1280 }, height: { ideal: constrainedDevice ? 540 : 720 },
        frameRate: { ideal: constrainedDevice ? 20 : 24, max: constrainedDevice ? 20 : 24 },
      },
    })
    if (!active || generation !== session) { acquired.getTracks().forEach(track => track.stop()); return false }
    stream = acquired; sourceVideo.srcObject = acquired; await sourceVideo.play()
    acquired.getVideoTracks()[0]?.applyConstraints({ frameRate: { ideal: constrainedDevice ? 20 : 24, max: constrainedDevice ? 20 : 24 } }).catch(() => {})
    await loadTrackers()
    return true
  }

  function closeCamera() {
    stream?.getTracks().forEach(track => track.stop()); stream = null; sourceVideo.pause(); sourceVideo.srcObject = null
  }

  function closeTrackers() {
    faceDetector?.close(); handDetector?.close(); faceDetector = null; handDetector = null; trackerPromise = null
  }

  function resetRound() {
    faces = [[], []]; previousFaces = [[], []]; faceUpdatedAt = [0, 0]; previousFaceUpdatedAt = [0, 0]; faceLastSeenAt = [0, 0]
    pens = [null, null]; pinching = [false, false]; wasPinching = [false, false]; palettePinch = [false, false]
    handLastSeenAt = [0, 0]; pinchReleaseStartedAt = [0, 0]
    colors = [palette[0], palette[0]]; activeStrokeIds = ['', '']; strokesByFace = [[], []]
    readySince = 0; startsAt = 0; swapEndsAt = 0; endsAt = 0; resultNoticeEndsAt = 0; resultEndsAt = 0
    lastFaceDetection = 0; lastHandDetection = 0; lastVideoTime = -1; handRunsSinceFace = 0; inferenceLoad = 1; canvasesDirty = true
    delete root.dataset.player1FacePoints; delete root.dataset.player2FacePoints; delete root.dataset.outsideStrokePoints
    swapStage.hidden = true; swapStage.classList.remove('is-active')
    waits.forEach(wait => { wait.hidden = false }); labels.forEach((label, side) => { label.textContent = `PLAYER ${side + 1} · 얼굴을 맞춰 주세요` })
    swatches.forEach(swatch => swatch.classList.toggle('is-active', swatch.dataset.color === palette[0]))
  }

  async function enter() {
    if (!active || phase !== 'lobby') return
    const session = ++generation; startButton.disabled = true; helpButton.disabled = true
    say('카메라와 얼굴 인식을 준비하고 있어요…', true)
    try {
      resetRound(); await openCamera(session)
      if (!active || generation !== session) return
      showRoom(); setPhase('waiting'); say('두 사람이 화면의 왼쪽과 오른쪽에 한 명씩 서 주세요.')
    } catch (error) {
      root.dataset.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      closeCamera(); showLobby()
      const secure = error instanceof Error && error.message === 'secure-context'
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      say(secure ? '카메라 사용을 위해 HTTPS 또는 localhost 주소로 열어 주세요.' : denied ? '브라우저에서 카메라 권한을 허용해 주세요.' : '카메라 또는 얼굴 인식을 준비하지 못했어요.', true)
    }
  }

  function beginCountdown() {
    startsAt = Date.now() + COUNTDOWN_SECONDS * 1000
    strokesByFace = [[], []]; activeStrokeIds = ['', '']; wasPinching = [false, false]; palettePinch = [false, false]
    waits.forEach(wait => { wait.hidden = true }); setPhase('countdown')
    showCenter('GET READY', String(COUNTDOWN_SECONDS), '시작하면 화면이 바뀌고 상대 얼굴에 그릴 수 있어요')
  }

  function beginSwap(now: number) {
    for (const side of [0, 1] as Side[]) {
      const source = cameraCanvases[side]; const target = swapCanvases[side]
      target.width = source.width; target.height = source.height
      target.getContext('2d')!.drawImage(source, 0, 0)
    }
    swapStage.hidden = false; swapStage.classList.remove('is-active'); void swapStage.offsetWidth; swapStage.classList.add('is-active')
    swapEndsAt = now + SWAP_DURATION_MS; centerMessage.hidden = true; setPhase('swapping')
  }

  function beginPlaying(now: number) {
    swapStage.hidden = true; swapStage.classList.remove('is-active'); endsAt = now + GAME_SECONDS * 1000; timer.textContent = '01:00'
    setPhase('playing'); centerMessage.hidden = true
    labels[0].textContent = 'PLAYER 1 · PLAYER 2 얼굴에 그리기'
    labels[1].textContent = 'PLAYER 2 · PLAYER 1 얼굴에 그리기'
    say('엄지와 검지를 맞대어 상대 얼굴에 그림을 그려 보세요.')
  }

  function finishRound() {
    if (phase === 'result') return
    const now = Date.now(); setPhase('result'); timer.textContent = '00:00'
    resultNoticeEndsAt = now + RESULT_NOTICE_SECONDS * 1000; resultEndsAt = resultNoticeEndsAt + RESULT_VIEW_SECONDS * 1000
    showCenter('TIME!', '완성된 얼굴을 보여주세요', '카메라를 바라보며 결과를 함께 감상해요')
  }

  function leave(message = '게임에서 나왔어요.') {
    ++generation; closeCamera(); closeTrackers(); resetRound(); showLobby(message)
  }

  function assignFaces(detected: FacePoint[][], now: number) {
    const assigned: [FacePoint[], FacePoint[]] = [[], []]
    const candidates = detected.filter(face => face.length > 0).sort((a, b) => screenCenter(a) - screenCenter(b))
    for (const face of candidates) {
      const center = screenCenter(face)
      const side: Side = center < .5 ? 0 : 1
      if (!assigned[side].length) assigned[side] = cropFace(face, side)
    }
    for (const side of [0, 1] as Side[]) {
      if (assigned[side].length) {
        previousFaces[side] = faces[side]; previousFaceUpdatedAt[side] = faceUpdatedAt[side]
        faces[side] = smoothFace(faces[side], assigned[side]); faceUpdatedAt[side] = now; faceLastSeenAt[side] = now
      } else if (now - faceLastSeenAt[side] > 620) {
        faces[side] = []
      }
      waits[side].hidden = Boolean(faces[side].length)
      root.dataset[side === 0 ? 'player1FacePoints' : 'player2FacePoints'] = String(faces[side].length)
    }
    if (phase === 'waiting') {
      if (assigned[0].length && assigned[1].length) {
        readySince ||= now
        if (now - readySince >= READY_HOLD_MS) beginCountdown()
      } else readySince = 0
    }
    canvasesDirty = true
  }

  function assignHands(detected: FacePoint[][], now: number) {
    const nextPens: [Point | null, Point | null] = [...pens]
    const nextPinching: [boolean, boolean] = [...pinching]
    const seen: [boolean, boolean] = [false, false]
    for (const hand of detected) {
      const wrist = hand[0]; const thumb = hand[4]; const index = hand[8]
      if (!wrist || !thumb || !index) continue
      const screenX = 1 - wrist.x; const side: Side = screenX < .5 ? 0 : 1
      const midpointScreenX = 1 - (thumb.x + index.x) / 2
      const point = { x: side === 0 ? midpointScreenX * 2 : (midpointScreenX - .5) * 2, y: (thumb.y + index.y) / 2 }
      const palm = Math.max(.035, Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y))
      const ratio = Math.hypot(thumb.x - index.x, thumb.y - index.y) / palm
      const distance = pens[side] ? Math.hypot(point.x - pens[side]!.x, point.y - pens[side]!.y) : 1
      const smoothing = clamp(.62 + distance * 2.4, .62, .94)
      nextPens[side] = pens[side]
        ? { x: pens[side]!.x + (point.x - pens[side]!.x) * smoothing, y: pens[side]!.y + (point.y - pens[side]!.y) * smoothing }
        : point
      seen[side] = true; handLastSeenAt[side] = now
      if (pinching[side]) {
        if (ratio < .52) {
          nextPinching[side] = true; pinchReleaseStartedAt[side] = 0
        } else {
          pinchReleaseStartedAt[side] ||= now
          nextPinching[side] = now - pinchReleaseStartedAt[side] < PINCH_RELEASE_GRACE_MS
          if (!nextPinching[side]) pinchReleaseStartedAt[side] = 0
        }
      } else {
        nextPinching[side] = ratio < .36
        pinchReleaseStartedAt[side] = 0
      }
    }
    for (const side of [0, 1] as Side[]) {
      if (seen[side]) continue
      if (now - handLastSeenAt[side] > HAND_LOST_GRACE_MS) {
        nextPens[side] = null; nextPinching[side] = false; pinchReleaseStartedAt[side] = 0
      }
    }
    pens = nextPens; pinching = nextPinching; canvasesDirty = true
    if (phase === 'playing') updateDrawing()
  }

  function panelPoint(point: Point, panel: Side) {
    const rect = feeds[panel].getBoundingClientRect()
    if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) return { x: rect.left, y: rect.top }
    const sourceWidth = sourceVideo.videoWidth / 2; const sourceHeight = sourceVideo.videoHeight
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight)
    const width = sourceWidth * scale; const height = sourceHeight * scale
    return { x: rect.left + (rect.width - width) / 2 + point.x * width, y: rect.top + (rect.height - height) / 2 + point.y * height }
  }

  function paletteAt(point: Point, side: Side) {
    const screen = panelPoint(point, side)
    return swatches.find(swatch => {
      if (Number(swatch.dataset.side) !== side) return false
      const bounds = swatch.getBoundingClientRect()
      return screen.x >= bounds.left && screen.x <= bounds.right && screen.y >= bounds.top && screen.y <= bounds.bottom
    })
  }

  function chooseColor(side: Side, color: string) {
    colors[side] = color
    swatches.forEach(swatch => {
      if (Number(swatch.dataset.side) === side) swatch.classList.toggle('is-active', swatch.dataset.color === color)
    })
  }

  function updateDrawing() {
    let outsidePoints = Number(root.dataset.outsideStrokePoints || 0)
    for (const player of [0, 1] as Side[]) {
      const pen = pens[player]; const target = (1 - player) as Side; const face = faces[target]
      if (!pen) { wasPinching[player] = false; activeStrokeIds[player] = ''; palettePinch[player] = false; continue }
      if (pinching[player] && !wasPinching[player]) {
        const swatch = paletteAt(pen, player)
        if (swatch?.dataset.color) {
          chooseColor(player, swatch.dataset.color); palettePinch[player] = true; activeStrokeIds[player] = ''
        }
      }
      if (!pinching[player]) { activeStrokeIds[player] = ''; palettePinch[player] = false }
      if (pinching[player] && !palettePinch[player] && face.length) {
        if (!activeStrokeIds[player] && isInsideFace(pen, face)) {
          activeStrokeIds[player] = `${player}-${performance.now().toFixed(2)}-${Math.random().toString(36).slice(2, 7)}`
          strokesByFace[target].push({ id: activeStrokeIds[player], color: colors[player], width: .011, points: [] })
        }
        const stroke = strokesByFace[target].find(candidate => candidate.id === activeStrokeIds[player])
        if (stroke) {
          const previous = stroke.points.at(-1); const anchored = { ...makeAnchor(pen, face), pressure: 1 }
          const previousPoint = previous ? resolveAnchor(previous, face) : null
          if (!previousPoint || Math.hypot(previousPoint.x - pen.x, previousPoint.y - pen.y) > .0025) {
            stroke.points.push(anchored)
            if (!isInsideFace(pen, face)) outsidePoints += 1
          }
        }
      }
      wasPinching[player] = pinching[player]
    }
    root.dataset.outsideStrokePoints = String(outsidePoints); canvasesDirty = true
  }

  function prepareTrackingInput() {
    const aspect = sourceVideo.videoWidth / sourceVideo.videoHeight
    const width = trackingWidth; const height = Math.max(1, Math.round(width / aspect))
    if (trackingInput.width !== width || trackingInput.height !== height) { trackingInput.width = width; trackingInput.height = height }
    trackingContext.drawImage(sourceVideo, 0, 0, width, height)
  }

  function updateTracking(now: number) {
    if (sourceVideo.readyState < 2 || !sourceVideo.videoWidth || sourceVideo.currentTime === lastVideoTime) return
    const faceDue = Boolean(faceDetector) && now - lastFaceDetection >= faceInterval * inferenceLoad
    const handDue = phase === 'playing' && Boolean(handDetector) && now - lastHandDetection >= handInterval * inferenceLoad
    const task = faceDue && handDue
      ? pinching.some(Boolean) && handRunsSinceFace < 2
        ? 'hand'
        : lastInference === 'hand' ? 'face' : 'hand'
      : faceDue ? 'face' : handDue ? 'hand' : null
    if (!task) return
    prepareTrackingInput(); lastVideoTime = sourceVideo.currentTime; lastInference = task
    const started = performance.now()
    try {
      if (task === 'face') {
        handRunsSinceFace = 0; lastFaceDetection = now; assignFaces(faceDetector!.detectForVideo(trackingInput, now).faceLandmarks, now)
      } else {
        handRunsSinceFace += 1; lastHandDetection = now; assignHands(handDetector!.detectForVideo(trackingInput, now).landmarks, now)
      }
    } catch {
      if (task === 'face') assignFaces([], now); else assignHands([], now)
    }
    const duration = performance.now() - started
    if (duration > 43) inferenceLoad = Math.min(2.1, inferenceLoad + .1)
    else if (duration < 28) inferenceLoad = Math.max(1, inferenceLoad - .025)
    root.dataset.performance = constrainedDevice || inferenceLoad > 1.3 ? 'reduced' : 'normal'
  }

  function resizeCanvas(canvas: HTMLCanvasElement, rect: DOMRect) {
    const ratio = Math.min(window.devicePixelRatio || 1, canvasPixelRatio)
    const width = Math.max(2, Math.round(rect.width * ratio)); const height = Math.max(2, Math.round(rect.height * ratio))
    if (canvas.width === width && canvas.height === height) return ratio
    canvas.width = width; canvas.height = height; return ratio
  }

  function drawCamera(panel: Side, sourceSide: Side) {
    const canvas = cameraCanvases[panel]; const context = cameraContexts[panel]; const rect = feeds[panel].getBoundingClientRect()
    const ratio = resizeCanvas(canvas, rect); context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#202020'; context.fillRect(0, 0, rect.width, rect.height)
    if (sourceVideo.readyState < 2 || !sourceVideo.videoWidth) return
    const sourceWidth = sourceVideo.videoWidth / 2; const sourceX = sourceSide === 0 ? sourceWidth : 0
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceVideo.videoHeight)
    const width = sourceWidth * scale; const height = sourceVideo.videoHeight * scale
    context.save(); context.translate(rect.width, 0); context.scale(-1, 1)
    context.drawImage(sourceVideo, sourceX, 0, sourceWidth, sourceVideo.videoHeight, (rect.width - width) / 2, (rect.height - height) / 2, width, height)
    context.restore()
  }

  function panelTransform(rect: DOMRect) {
    if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) return { x: 0, y: 0, width: 0, height: 0 }
    const sourceWidth = sourceVideo.videoWidth / 2; const scale = Math.max(rect.width / sourceWidth, rect.height / sourceVideo.videoHeight)
    const width = sourceWidth * scale; const height = sourceVideo.videoHeight * scale
    return { x: (rect.width - width) / 2, y: (rect.height - height) / 2, width, height }
  }

  function canvasPoint(point: Point, transform: ReturnType<typeof panelTransform>) {
    return { x: transform.x + point.x * transform.width, y: transform.y + point.y * transform.height }
  }

  function drawStrokes(context: CanvasRenderingContext2D, rect: DOMRect, transform: ReturnType<typeof panelTransform>, strokes: Stroke[], face: FacePoint[]) {
    if (!face.length) return
    const scale = faceScale(face)
    context.lineCap = 'round'; context.lineJoin = 'round'
    for (const stroke of strokes) {
      if (!stroke.points.length) continue
      context.beginPath(); context.strokeStyle = stroke.color; context.lineWidth = Math.max(3, stroke.width * Math.min(rect.width, rect.height))
      stroke.points.forEach((anchor, index) => {
        const resolved = resolveAnchor(anchor, face, scale); if (!resolved) return
        const point = canvasPoint(resolved, transform)
        if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y)
      })
      if (stroke.points.length === 1) {
        const point = resolveAnchor(stroke.points[0], face, scale)
        if (point) { const p = canvasPoint(point, transform); context.lineTo(p.x + .01, p.y + .01) }
      }
      context.stroke()
    }
  }

  function drawPen(context: CanvasRenderingContext2D, transform: ReturnType<typeof panelTransform>, point: Point, color: string, isPinching: boolean) {
    const p = canvasPoint(point, transform); const scale = isPinching ? 1.08 : 1
    context.save(); context.translate(p.x, p.y); context.rotate(-.58); context.scale(scale, scale)
    context.shadowColor = 'rgba(0,0,0,.42)'; context.shadowBlur = 6; context.shadowOffsetY = 3
    context.fillStyle = '#ead6b1'; context.strokeStyle = '#fff'; context.lineWidth = 1.8
    context.beginPath(); context.moveTo(0, 0); context.lineTo(-6.5, -12); context.lineTo(6.5, -12); context.closePath(); context.fill(); context.stroke()
    context.shadowColor = 'transparent'; context.fillStyle = '#171717'
    context.beginPath(); context.moveTo(0, 0); context.lineTo(-2.4, -4.5); context.lineTo(2.4, -4.5); context.closePath(); context.fill()
    context.fillStyle = color; context.strokeStyle = '#fff'; context.lineWidth = 2
    context.beginPath(); context.roundRect(-6.5, -39, 13, 28, 2.5); context.fill(); context.stroke()
    context.fillStyle = '#f0b0bd'; context.beginPath(); context.roundRect(-6.5, -45, 13, 7, [3, 3, 1, 1]); context.fill(); context.stroke()
    if (isPinching) {
      context.strokeStyle = 'rgba(255,255,255,.8)'; context.lineWidth = 1.5
      context.beginPath(); context.arc(0, 0, 8.5, 0, Math.PI * 2); context.stroke()
    }
    context.restore()
  }

  function drawOverlays(now: number) {
    for (const panel of [0, 1] as Side[]) {
      const canvas = overlayCanvases[panel]; const context = overlayContexts[panel]; const rect = feeds[panel].getBoundingClientRect()
      const ratio = resizeCanvas(canvas, rect); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height)
      const transform = panelTransform(rect)
      const shownSide = phase === 'swapping' || phase === 'playing' || phase === 'result' ? (1 - panel) as Side : panel
      const predicted = predictFace(faces[shownSide], previousFaces[shownSide], faceUpdatedAt[shownSide], previousFaceUpdatedAt[shownSide], now)
      drawStrokes(context, rect, transform, strokesByFace[shownSide], predicted)
      if (phase === 'playing' && pens[panel]) drawPen(context, transform, pens[panel]!, colors[panel], pinching[panel])
    }
    canvasesDirty = false
  }

  function updatePhase(now: number) {
    if (phase === 'countdown') {
      const remaining = Math.max(0, Math.ceil((startsAt - now) / 1000)); messageMain.textContent = String(Math.max(1, remaining))
      if (now >= startsAt) beginSwap(now)
    } else if (phase === 'swapping') {
      if (now >= swapEndsAt) beginPlaying(now)
    } else if (phase === 'playing') {
      const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000)); timer.textContent = formatClock(remaining)
      if (now >= endsAt) finishRound()
    } else if (phase === 'result') {
      if (now >= resultNoticeEndsAt) centerMessage.hidden = true
      if (now >= resultEndsAt) leave('게임이 끝났어요. 다시 시작해 보세요.')
    }
  }

  function render(now: number) {
    if (!active) return
    if (!paused && phase !== 'lobby') {
      updateTracking(now); updatePhase(Date.now())
      if (now - lastCameraRender >= cameraInterval) {
        const swapped = phase === 'swapping' || phase === 'playing' || phase === 'result'
        drawCamera(0, swapped ? 1 : 0); drawCamera(1, swapped ? 0 : 1); lastCameraRender = now
      }
      if (canvasesDirty || now - lastOverlayRender >= overlayInterval) { drawOverlays(now); lastOverlayRender = now }
    }
    animationFrame = requestAnimationFrame(render)
  }

  startButton.addEventListener('click', () => { void enter() })
  helpButton.addEventListener('click', () => say('두 사람이 카메라의 왼쪽과 오른쪽에 서면 시작됩니다. 엄지와 검지를 맞대어 상대 얼굴에 그리세요.'))
  leaveButton.addEventListener('click', () => leave())
  swatches.forEach(swatch => swatch.addEventListener('click', () => {
    const side = Number(swatch.dataset.side) as Side; if (swatch.dataset.color) chooseColor(side, swatch.dataset.color)
  }))
  sourceVideo.addEventListener('loadeddata', () => { lastVideoTime = -1; canvasesDirty = true })

  return {
    captureFrame() {
      const width = Math.max(2, Math.floor(root.clientWidth)); const height = Math.max(2, Math.floor(root.clientHeight))
      captureCanvas.width = width; captureCanvas.height = height; captureContext.fillStyle = '#151515'; captureContext.fillRect(0, 0, width, height)
      if (!room.hidden) {
        const rootRect = root.getBoundingClientRect()
        for (const panel of [0, 1] as Side[]) {
          const rect = feeds[panel].getBoundingClientRect(); const x = rect.left - rootRect.left; const y = rect.top - rootRect.top
          captureContext.drawImage(cameraCanvases[panel], x, y, rect.width, rect.height)
          captureContext.drawImage(overlayCanvases[panel], x, y, rect.width, rect.height)
        }
      }
      return captureCanvas
    },
    start() {
      if (active) return
      active = true; paused = false; showLobby(); animationFrame = requestAnimationFrame(render)
    },
    stop() {
      if (!active) return
      active = false; paused = false; ++generation; cancelAnimationFrame(animationFrame)
      const pendingTrackers = trackerPromise; closeCamera(); closeTrackers(); resetRound(); clearTimeout(statusTimer); status.textContent = ''; showLobby()
      void pendingTrackers?.then(() => { if (!active) closeTrackers() }).catch(() => {})
    },
    setPaused(value: boolean) { paused = value },
  }
}
