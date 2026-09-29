import './rubber-human.css'
import type { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
import { coverPoint } from './lemonade-physics'
import {
  limitVector,
  pointInPolygon,
  rubberWeight,
  stepElastic,
  type ElasticPoint,
  type RubberPoint,
} from './rubber-human-physics'

type Point = RubberPoint
type Triangle = [number, number, number]
type TrackedHand = Point & { id: number; pinching: boolean; seen: number }
type FaceFrame = {
  points: Point[]
  oval: Point[]
  width: number
  height: number
}
type Grab = {
  handId: number
  anchor: number
  offsetX: number
  offsetY: number
  origin: Point
  target: Point
  elastic: ElasticPoint
  active: boolean
  radius: number
}

const BASE = import.meta.env.BASE_URL
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]
// MediaPipe's main face tessellation stops at the eyelid rims. These fans fill
// both openings with the live eye texture so the eyes deform with the skin
// instead of revealing the undeformed camera image underneath.
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
const LEFT_IRIS_CENTER = 473
const RIGHT_IRIS_CENTER = 468
// Ordered around the inner lip edge. Filling this opening keeps the teeth,
// tongue, and dark mouth cavity attached to the same deforming face surface.
const INNER_MOUTH = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
const constrained = (navigator.hardwareConcurrency || 8) <= 4 || deviceMemory <= 4
const frameInterval = 1000 / (constrained ? 24 : 30)
const handInterval = constrained ? 112 : 76
const faceInterval = constrained ? 128 : 92
const isIOS = /iP(?:hone|ad|od)/i.test(navigator.userAgent)
const needsVideoSnapshot = isIOS || (/AppleWebKit/i.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)/i.test(navigator.userAgent))

function faceFrame(points: Point[]): FaceFrame {
  const oval = FACE_OVAL.map(index => points[index]).filter(Boolean)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of oval) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }

  return { points, oval, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function smoothPoints(previous: Point[] | undefined, next: Point[]) {
  if (!previous || previous.length !== next.length) return next
  return next.map((point, index) => ({
    x: previous[index].x + (point.x - previous[index].x) * .62,
    y: previous[index].y + (point.y - previous[index].y) * .62,
  }))
}

function nearestLandmark(point: Point, face: FaceFrame) {
  let nearest = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  const limit = Math.min(468, face.points.length)

  for (let index = 0; index < limit; index += 1) {
    const candidate = face.points[index]
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
    if (distance < nearestDistance) { nearestDistance = distance; nearest = index }
  }

  return nearest
}

function resolveOrigin(grab: Grab, face: FaceFrame | null) {
  const landmark = face?.points[grab.anchor]
  if (!landmark || !face) return grab.origin
  grab.origin.x = landmark.x + grab.offsetX * face.width
  grab.origin.y = landmark.y + grab.offsetY * face.height
  grab.radius = Math.max(72, Math.min(face.width, face.height) * .72)
  return grab.origin
}

function deformPoint(point: Point, grabs: Grab[]) {
  let x = point.x
  let y = point.y

  for (const grab of grabs) {
    const weight = rubberWeight(Math.hypot(point.x - grab.origin.x, point.y - grab.origin.y), grab.radius)
    x += grab.elastic.x * weight
    y += grab.elastic.y * weight
  }

  return { x, y }
}

// The tracked tessellation ends at the face oval. This collar is only drawn
// during rebound: it fills the temporary gap as the face returns, while a live
// pull deliberately leaves the surrounding camera image completely untouched.
function faceCollar(face: FaceFrame, grabs: Grab[]) {
  const center = face.oval.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
  center.x /= Math.max(1, face.oval.length); center.y /= Math.max(1, face.oval.length)
  const inner = face.oval.map(source => ({ source, destination: deformPoint(source, grabs) }))
  const boundaryStretch = inner.reduce((maximum, vertex) => Math.max(maximum, Math.hypot(
    vertex.destination.x - vertex.source.x,
    vertex.destination.y - vertex.source.y,
 )), 0)
  // A very large pull near the jaw or temple needs a wider collar as well;
  // otherwise the bridge can fold back over itself before it reaches the
  // unmoved camera image.
  const padding = Math.max(56, Math.min(face.width, face.height) * .48, boundaryStretch * 1.25 + 24)
  const outer = face.oval.map(point => {
    const length = Math.max(1, Math.hypot(point.x - center.x, point.y - center.y))
    return { x: point.x + (point.x - center.x) / length * padding, y: point.y + (point.y - center.y) / length * padding }
  })
  const vertices: Array<{ source: Point; destination: Point }> = []

  inner.forEach((vertex, index) => {
    const next = (index + 1) % face.oval.length
    // A pair of triangles makes a continuous bridge between the deforming
    // face contour and an identity-mapped outer ring.
    vertices.push(
      vertex,
      { source: outer[index], destination: outer[index] },
      inner[next],
      inner[next],
      { source: outer[index], destination: outer[index] },
      { source: outer[next], destination: outer[next] },
    )
  })

  return vertices
}

type RubberRenderer = {
  render: (video: HTMLVideoElement, width: number, height: number, face: FaceFrame | null, grabs: Grab[]) => void
  destroy: () => void
  accelerated: boolean
}

function makeTriangles(connections: { start: number; end: number }[]) {
  const triangles: Triangle[] = []
  for (let index = 0; index + 2 < connections.length; index += 3) {
    const first = connections[index]
    const second = connections[index + 1]
    const third = connections[index + 2]
    if (first.end === second.start && second.end === third.start && third.end === first.start) {
      triangles.push([first.start, first.end, second.end])
    }
  }
  const addEye = (outline: number[], center: number) => {
    outline.forEach((landmark, index) => {
      triangles.push([center, landmark, outline[(index + 1) % outline.length]])
    })
  }
  const addPolygon = (outline: number[], pivot: number) => {
    const pivotIndex = outline.indexOf(pivot)
    const ordered = [...outline.slice(pivotIndex), ...outline.slice(0, pivotIndex)]
    for (let index = 1; index < ordered.length - 1; index += 1) {
      triangles.push([pivot, ordered[index], ordered[index + 1]])
    }
  }
  addEye(LEFT_EYE, LEFT_IRIS_CENTER)
  addEye(RIGHT_EYE, RIGHT_IRIS_CENTER)
  addPolygon(INNER_MOUTH, 13)
  return triangles
}

function createRubberRenderer(canvas: HTMLCanvasElement, triangles: Triangle[]): RubberRenderer {
  // The visible WebGL canvas is also the common photo/video capture source.
  // Preserving its last completed frame avoids blank captures between RAFs.
  const attributes = { alpha: false, antialias: true, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'default' as const }
  const gl = canvas.getContext('webgl', attributes) as WebGLRenderingContext | null

  if (!gl) {
    const context = canvas.getContext('2d', { alpha: false })!
    const source = document.createElement('canvas')
    const sourceContext = source.getContext('2d', { alpha: false })!

    const render = (video: HTMLVideoElement, width: number, height: number, face: FaceFrame | null, grabs: Grab[]) => {
      if (source.width !== canvas.width || source.height !== canvas.height) {
        source.width = canvas.width; source.height = canvas.height
      }
      const ratioX = canvas.width / width; const ratioY = canvas.height / height
      sourceContext.setTransform(ratioX, 0, 0, ratioY, 0, 0)
      sourceContext.fillStyle = '#10100f'; sourceContext.fillRect(0, 0, width, height)
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
      const drawWidth = video.videoWidth * scale; const drawHeight = video.videoHeight * scale
      sourceContext.save(); sourceContext.translate(width, 0); sourceContext.scale(-1, 1)
      sourceContext.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
      sourceContext.restore()
      context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(source, 0, 0)
      if (!face || !grabs.length) return
      context.setTransform(ratioX, 0, 0, ratioY, 0, 0)
      const drawTriangle = (sourcePoints: Point[], destination: Point[]) => {
        const [s0, s1, s2] = sourcePoints; const [d0, d1, d2] = destination
        const sx1 = s1.x - s0.x; const sy1 = s1.y - s0.y; const sx2 = s2.x - s0.x; const sy2 = s2.y - s0.y
        const determinant = sx1 * sy2 - sx2 * sy1
        if (Math.abs(determinant) < .001) return
        const dx1 = d1.x - d0.x; const dy1 = d1.y - d0.y; const dx2 = d2.x - d0.x; const dy2 = d2.y - d0.y
        const a = (dx1 * sy2 - dx2 * sy1) / determinant
        const b = (dy1 * sy2 - dy2 * sy1) / determinant
        const c = (dx2 * sx1 - dx1 * sx2) / determinant
        const d = (dy2 * sx1 - dy1 * sx2) / determinant
        const e = d0.x - a * s0.x - c * s0.y
        const f = d0.y - b * s0.x - d * s0.y
        context.save(); context.beginPath(); context.moveTo(d0.x, d0.y); context.lineTo(d1.x, d1.y); context.lineTo(d2.x, d2.y); context.closePath(); context.clip()
        context.transform(a, b, c, d, e, f); context.drawImage(source, 0, 0, width, height); context.restore()
      }
      for (const triangle of triangles) {
        const sourcePoints = triangle.map(index => face.points[index])
        if (sourcePoints.some(point => !point)) continue
        drawTriangle(sourcePoints as Point[], (sourcePoints as Point[]).map(point => deformPoint(point, grabs)))
      }
      if (grabs.every(grab => !grab.active)) {
        const collar = faceCollar(face, grabs)
        for (let index = 0; index < collar.length; index += 3) {
          drawTriangle(collar.slice(index, index + 3).map(vertex => vertex.source), collar.slice(index, index + 3).map(vertex => vertex.destination))
        }
      }
    }

    return { render, destroy() {}, accelerated: false }
  }

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_texture;
    varying vec2 v_texture;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texture = a_texture; }
  `
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_video;
    varying vec2 v_texture;
    void main() { gl_FragColor = texture2D(u_video, v_texture); }
  `
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader error')
    return shader
  }
  const program = gl.createProgram()!
  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertexShader); gl.attachShader(program, fragmentShader); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program error')
  const buffer = gl.createBuffer()!
  const texture = gl.createTexture()!
  const videoSnapshot = document.createElement('canvas')
  const videoSnapshotContext = videoSnapshot.getContext('2d', { alpha: false })!
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const textureLocation = gl.getAttribLocation(program, 'a_texture')
  gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(positionLocation); gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(textureLocation); gl.vertexAttribPointer(textureLocation, 2, gl.FLOAT, false, 16, 8)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(gl.getUniformLocation(program, 'u_video'), 0)

  const render = (video: HTMLVideoElement, width: number, height: number, face: FaceFrame | null, grabs: Grab[]) => {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(.063, .063, .059, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    if (needsVideoSnapshot) {
      // WebKit may recycle a live video's GPU buffer while the same canvas is
      // being recorded. A small CPU snapshot prevents green capture frames.
      const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
      const snapshotWidth = Math.max(1, Math.round(video.videoWidth * ratio))
      const snapshotHeight = Math.max(1, Math.round(video.videoHeight * ratio))
      if (videoSnapshot.width !== snapshotWidth || videoSnapshot.height !== snapshotHeight) {
        videoSnapshot.width = snapshotWidth; videoSnapshot.height = snapshotHeight
      }
      videoSnapshotContext.drawImage(video, 0, 0, snapshotWidth, snapshotHeight)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, videoSnapshot)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
    }
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const drawWidth = video.videoWidth * scale; const drawHeight = video.videoHeight * scale
    const offsetX = (width - drawWidth) / 2; const offsetY = (height - drawHeight) / 2
    const toVertex = (destination: Point, source: Point) => [
      destination.x / width * 2 - 1,
      1 - destination.y / height * 2,
      (width - source.x - offsetX) / drawWidth,
      (source.y - offsetY) / drawHeight,
    ]
    const topLeft = { x: 0, y: 0 }; const topRight = { x: width, y: 0 }
    const bottomLeft = { x: 0, y: height }; const bottomRight = { x: width, y: height }
    const base = new Float32Array([
      ...toVertex(topLeft, topLeft), ...toVertex(bottomLeft, bottomLeft), ...toVertex(topRight, topRight),
      ...toVertex(topRight, topRight), ...toVertex(bottomLeft, bottomLeft), ...toVertex(bottomRight, bottomRight),
    ])
    gl.bufferData(gl.ARRAY_BUFFER, base, gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES, 0, 6)
    if (!face || !grabs.length) return
    const texturedVertices: number[] = []
    for (const triangle of triangles) {
      const sourcePoints = triangle.map(index => face.points[index])
      if (sourcePoints.some(point => !point)) continue
      for (const sourcePoint of sourcePoints as Point[]) texturedVertices.push(...toVertex(deformPoint(sourcePoint, grabs), sourcePoint))
    }
    if (grabs.every(grab => !grab.active)) {
      for (const vertex of faceCollar(face, grabs)) texturedVertices.push(...toVertex(vertex.destination, vertex.source))
    }
    if (!texturedVertices.length) return
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texturedVertices), gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, texturedVertices.length / 4)
  }

  return {
    render,
    accelerated: true,
    destroy() {
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteShader(vertexShader); gl.deleteShader(fragmentShader); gl.deleteProgram(program)
    },
  }
}

export function createRubberHuman(root: HTMLElement) {
  root.innerHTML = `
    <video class="rubber-human__camera" muted autoplay playsinline aria-hidden="true"></video>
    <canvas class="rubber-human__canvas" aria-label="핀치로 부드럽게 늘어나는 실시간 얼굴"></canvas>
    <header class="rubber-human__header">
      <p>FACE × HAND INTERACTION / 11</p>
      <h2>고무 인간</h2>
      <span>Soft face, elastic memory.</span>
    </header>
    <div class="rubber-human__readout"><i></i><span class="rubber-human__live">CAMERA OFF</span><strong class="rubber-human__mode">WAITING</strong></div>
    <div class="rubber-human__gate">
      <div class="rubber-human__mark" aria-hidden="true"><span></span><span></span></div>
      <p class="rubber-human__eyebrow">BECOME ELASTIC</p>
      <h3>얼굴을 늘려 볼까요?</h3>
      <p>얼굴 위에서 엄지와 검지를 맞댄 뒤<br>그대로 천천히 당겨 보세요.</p>
      <button class="rubber-human__start" type="button">카메라 켜기 <span>↗</span></button>
      <small>영상과 얼굴·손 좌표는 기기 밖으로 전송되지 않습니다.</small>
    </div>
    <div class="rubber-human__pinch" aria-hidden="true"><span></span></div>
    <p class="rubber-human__hint">얼굴 위에서 PINCH · 당겨서 늘리기 · 놓으면 복원</p>
    <p class="rubber-human__status" role="status" aria-live="polite"></p>
  `

  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const video = q<HTMLVideoElement>('.rubber-human__camera')
  const canvas = q<HTMLCanvasElement>('.rubber-human__canvas')
  const gate = q<HTMLDivElement>('.rubber-human__gate')
  const startButton = q<HTMLButtonElement>('.rubber-human__start')
  const status = q<HTMLParagraphElement>('.rubber-human__status')
  const live = q<HTMLSpanElement>('.rubber-human__live')
  const mode = q<HTMLElement>('.rubber-human__mode')
  const trackingInput = document.createElement('canvas')
  const trackingContext = trackingInput.getContext('2d', { alpha: false })!
  let active = false
  let paused = false
  let ready = false
  let starting = false
  let generation = 0
  let stream: MediaStream | null = null
  let handDetector: HandLandmarker | null = null
  let faceDetector: FaceLandmarker | null = null
  let trackerPromise: Promise<void> | null = null
  let renderer: RubberRenderer | null = null
  let triangles: Triangle[] = []
  let frame = 0
  let lastFrame = 0
  let lastHandDetection = 0
  let lastFaceDetection = 0
  let lastVideoTime = -1
  let face: FaceFrame | null = null
  let faceSeen = 0
  let hands = new Map<number, TrackedHand>()
  let grabs: Grab[] = []
  let width = 1
  let height = 1
  let statusTimer = 0

  function say(message: string, persistent = false) {
    clearTimeout(statusTimer); status.textContent = message
    if (!persistent) statusTimer = window.setTimeout(() => { status.textContent = '' }, 4200)
  }

  function resize() {
    if (!active) return
    const bounds = root.getBoundingClientRect()
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
    const ratio = Math.min(devicePixelRatio || 1, constrained ? 1.35 : 1.8, 1600 / Math.max(width, height))
    canvas.width = Math.max(2, Math.round(width * ratio / 2) * 2)
    canvas.height = Math.max(2, Math.round(height * ratio / 2) * 2)
  }

  async function loadTrackers() {
    if (handDetector && faceDetector) return
    if (!trackerPromise) {
      trackerPromise = (async () => {
        const { FilesetResolver, HandLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`)
        const handOptions = {
          runningMode: 'VIDEO' as const, numHands: 2,
          minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .55,
        }
        const faceOptions = {
          runningMode: 'VIDEO' as const, numFaces: 1,
          minFaceDetectionConfidence: .58, minFacePresenceConfidence: .58, minTrackingConfidence: .55,
        }
        const makeHand = async () => {
          try { return await HandLandmarker.createFromOptions(files, { ...handOptions, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'GPU' } }) }
          catch { return HandLandmarker.createFromOptions(files, { ...handOptions, baseOptions: { modelAssetPath: `${BASE}mediapipe/hand_landmarker.task`, delegate: 'CPU' } }) }
        }
        const makeFace = async () => {
          try { return await FaceLandmarker.createFromOptions(files, { ...faceOptions, baseOptions: { modelAssetPath: `${BASE}mediapipe/face_landmarker.task`, delegate: 'GPU' } }) }
          catch { return FaceLandmarker.createFromOptions(files, { ...faceOptions, baseOptions: { modelAssetPath: `${BASE}mediapipe/face_landmarker.task`, delegate: 'CPU' } }) }
        }
        const [hand, detectedFace] = await Promise.all([makeHand(), makeFace()])
        handDetector = hand; faceDetector = detectedFace
        triangles = makeTriangles(FaceLandmarker.FACE_LANDMARKS_TESSELATION ?? [])
      })().catch(error => { trackerPromise = null; throw error })
    }
    await trackerPromise
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
      renderer?.destroy(); renderer = createRubberRenderer(canvas, triangles)
      ready = true; gate.hidden = true; root.classList.add('is-ready'); live.textContent = 'CAMERA LIVE'; mode.textContent = 'FIND YOUR FACE'
      lastVideoTime = -1; lastHandDetection = 0; lastFaceDetection = 0
      if (!renderer.accelerated) say('WebGL을 사용할 수 없어 간소화된 변형으로 실행합니다.')
      else say('얼굴 위에서 엄지와 검지를 맞대고 당겨 보세요.')
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream === acquired) { releaseCamera(); say('카메라 연결이 끊겼어요. 다시 켜 주세요.', true) }
      }, { once: true })
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop())
      if (generation !== attempt) return
      stream = null; video.srcObject = null
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      say(phase === 'tracking' ? '얼굴과 손 인식을 준비하지 못했어요. 다시 시도해 주세요.' : denied ? '카메라 권한을 허용해 주세요.' : '카메라를 연결하지 못했어요.', true)
    } finally {
      if (generation === attempt) { starting = false; startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>' }
    }
  }

  function matchSlots(points: Point[]) {
    if (points.length === 1 && hands.size) {
      const closest = [...hands].sort((a, b) => Math.hypot(a[1].x - points[0].x, a[1].y - points[0].y) - Math.hypot(b[1].x - points[0].x, b[1].y - points[0].y))[0]
      return [closest?.[0] ?? 0]
    }
    if (points.length !== 2 || !hands.has(0) || !hands.has(1)) return [0, 1]
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
    const direct = distance(points[0], hands.get(0)!) + distance(points[1], hands.get(1)!)
    const crossed = distance(points[0], hands.get(1)!) + distance(points[1], hands.get(0)!)
    return crossed < direct ? [1, 0] : [0, 1]
  }

  function updateFace(now: number) {
    if (!faceDetector || now - lastFaceDetection < faceInterval) return
    lastFaceDetection = now
    const result = faceDetector.detectForVideo(trackingInput, now).faceLandmarks[0]
    if (!result) {
      if (now - faceSeen > 450) face = null
      return
    }
    const next = result.map(point => coverPoint(point, trackingInput.width, trackingInput.height, width, height))
    face = faceFrame(smoothPoints(face?.points, next)); faceSeen = now
  }

  function updateHands(now: number) {
    if (!handDetector || now - lastHandDetection < handInterval) return
    lastHandDetection = now
    const landmarks = handDetector.detectForVideo(trackingInput, now).landmarks.slice(0, 2)
    const palms = landmarks.map(hand => coverPoint(hand[9], trackingInput.width, trackingInput.height, width, height))
    const slots = matchSlots(palms)
    const next = new Map<number, TrackedHand>()
    landmarks.forEach((hand, index) => {
      const thumb = coverPoint(hand[4], trackingInput.width, trackingInput.height, width, height)
      const finger = coverPoint(hand[8], trackingInput.width, trackingInput.height, width, height)
      const pinch = { x: (thumb.x + finger.x) / 2, y: (thumb.y + finger.y) / 2 }
      const palmWidth = Math.max(.001, Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y))
      const pinchDistance = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y)
      const existing = grabs.find(grab => grab.handId === slots[index] && grab.active)
      next.set(slots[index], { ...pinch, id: slots[index], pinching: pinchDistance / palmWidth < (existing ? .55 : .43), seen: now })
    })
    hands = next

    for (const grab of grabs) {
      const hand = hands.get(grab.handId)
      if (!hand?.pinching) grab.active = false
    }
    if (face) {
      for (const hand of hands.values()) {
        if (!hand.pinching || grabs.some(grab => grab.handId === hand.id && grab.active)) continue
        if (!pointInPolygon(hand, face.oval)) continue
        const anchor = nearestLandmark(hand, face)
        const landmark = face.points[anchor]
        grabs = grabs.filter(grab => grab.handId !== hand.id)
        grabs.push({
          handId: hand.id, anchor,
          offsetX: (hand.x - landmark.x) / face.width,
          offsetY: (hand.y - landmark.y) / face.height,
          origin: { ...hand }, target: { x: 0, y: 0 },
          elastic: { x: 0, y: 0, vx: 0, vy: 0 }, active: true,
          radius: Math.max(72, Math.min(face.width, face.height) * .72),
        })
      }
    }
    const firstHand = [...hands.values()][0]
    root.classList.toggle('has-hand', !!firstHand)
    root.classList.toggle('is-pinching', !!firstHand?.pinching)
    if (firstHand) {
      root.style.setProperty('--pinch-x', `${firstHand.x}px`)
      root.style.setProperty('--pinch-y', `${firstHand.y}px`)
    }
  }

  function track(now: number) {
    if (!ready || video.readyState < 2 || video.currentTime === lastVideoTime) return
    const shouldTrackFace = now - lastFaceDetection >= faceInterval
    const shouldTrackHands = now - lastHandDetection >= handInterval
    if (!shouldTrackFace && !shouldTrackHands) return
    lastVideoTime = video.currentTime
    const inputWidth = constrained ? 420 : 560
    const inputHeight = Math.max(1, Math.round(inputWidth * video.videoHeight / video.videoWidth))
    if (trackingInput.width !== inputWidth || trackingInput.height !== inputHeight) {
      trackingInput.width = inputWidth; trackingInput.height = inputHeight
    }
    trackingContext.setTransform(-1, 0, 0, 1, inputWidth, 0)
    trackingContext.drawImage(video, 0, 0, inputWidth, inputHeight)
    trackingContext.resetTransform()
    try { updateFace(now); updateHands(now) }
    catch { releaseCamera(); say('트래킹이 중단됐어요. 카메라를 다시 켜 주세요.', true) }
  }

  function updateGrabs(deltaTime: number, now: number) {
    for (const grab of grabs) {
      const origin = resolveOrigin(grab, face)
      const hand = hands.get(grab.handId)
      if (grab.active && (!hand?.pinching || now - hand.seen > 260)) grab.active = false
      if (grab.active && hand) {
        const desired = limitVector({ x: hand.x - origin.x, y: hand.y - origin.y }, Math.min(Math.max(face?.width ?? 200, face?.height ?? 260) * 2.05, Math.max(width, height) * .58))
        grab.target.x = desired.x; grab.target.y = desired.y
        stepElastic(grab.elastic, grab.target, deltaTime, 280, 22)
      } else {
        grab.target.x = 0; grab.target.y = 0
        stepElastic(grab.elastic, grab.target, deltaTime, 88, 7.5)
      }
    }
    grabs = grabs.filter(grab => grab.active || Math.hypot(grab.elastic.x, grab.elastic.y) > .16 || Math.hypot(grab.elastic.vx, grab.elastic.vy) > 1.2)
    const stretching = grabs.some(grab => grab.active)
    const rebounding = !stretching && grabs.length > 0
    root.classList.toggle('is-grabbing', stretching)
    root.classList.toggle('is-rebounding', rebounding)
    root.dataset.interaction = stretching ? 'stretching' : rebounding ? 'rebounding' : face ? 'ready' : 'searching'
    mode.textContent = stretching ? 'STRETCHING' : rebounding ? 'BOUNCE BACK' : face ? 'PINCH YOUR FACE' : 'FIND YOUR FACE'
  }

  function animate(now: number) {
    if (!active || paused || document.hidden) return
    frame = requestAnimationFrame(animate)
    if (now - lastFrame < frameInterval) return
    const deltaTime = Math.min((now - (lastFrame || now)) / 1000, .05); lastFrame = now
    track(now); updateGrabs(deltaTime, now)
    if (ready && video.readyState >= 2) renderer?.render(video, width, height, face, grabs)
  }

  function releaseCamera() {
    ++generation; starting = false; ready = false
    stream?.getTracks().forEach(track => track.stop()); stream = null
    video.pause(); video.srcObject = null
    handDetector?.close(); handDetector = null
    faceDetector?.close(); faceDetector = null; trackerPromise = null
    renderer?.destroy(); renderer = null
    face = null; hands.clear(); grabs = []
    gate.hidden = false; root.classList.remove('is-ready', 'has-hand', 'is-pinching', 'is-grabbing', 'is-rebounding')
    root.dataset.interaction = 'idle'; live.textContent = 'CAMERA OFF'; mode.textContent = 'WAITING'
    startButton.disabled = false; startButton.innerHTML = '카메라 켜기 <span>↗</span>'
  }

  startButton.addEventListener('click', () => { void enableCamera() })
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
