import { coverPoint } from './lemonade-physics'

export type HeadPoint = { x: number; y: number }

export type HeadShape = {
  left: HeadPoint[]
  right: HeadPoint[]
  top: HeadPoint
  hairline: HeadPoint[]
  seen: number
  source: 'human-seg'
}

type ExtractionOptions = {
  confidence: Float32Array
  maskWidth: number
  maskHeight: number
  landmarks: HeadPoint[]
  inputWidth: number
  inputHeight: number
  outputWidth: number
  outputHeight: number
  now: number
}

const HUMAN_CONFIDENCE_THRESHOLD = .5

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

function normalize(point: HeadPoint) {
  const length = Math.max(.001, Math.hypot(point.x, point.y))
  return { x: point.x / length, y: point.y / length }
}

function screenPoint(point: HeadPoint, options: ExtractionOptions) {
  return coverPoint(
    { x: point.x / options.inputWidth, y: point.y / options.inputHeight },
    options.inputWidth,
    options.inputHeight,
    options.outputWidth,
    options.outputHeight,
  )
}

export function extractHumanHeadShape(options: ExtractionOptions): HeadShape | null {
  const { landmarks, inputWidth, inputHeight, confidence, maskWidth, maskHeight } = options
  if (maskWidth < 2 || maskHeight < 2 || confidence.length !== maskWidth * maskHeight) return null
  const foreheadRaw = landmarks[10]; const chinRaw = landmarks[152]
  const leftSideRaw = landmarks[234]; const rightSideRaw = landmarks[454]
  const leftEarRaw = landmarks[127] ?? leftSideRaw; const rightEarRaw = landmarks[356] ?? rightSideRaw
  if (!foreheadRaw || !chinRaw || !leftSideRaw || !rightSideRaw || !leftEarRaw || !rightEarRaw) return null

  const pixel = (point: HeadPoint) => ({ x: point.x * inputWidth, y: point.y * inputHeight })
  const forehead = pixel(foreheadRaw); const chin = pixel(chinRaw)
  const leftSide = pixel(leftSideRaw); const rightSide = pixel(rightSideRaw)
  const earA = pixel(leftEarRaw); const earB = pixel(rightEarRaw)
  const up = normalize({ x: forehead.x - chin.x, y: forehead.y - chin.y })
  let across = { x: -up.y, y: up.x }
  if ((rightSide.x - leftSide.x) * across.x + (rightSide.y - leftSide.y) * across.y < 0) {
    across = { x: -across.x, y: -across.y }
  }
  const baseCenter = { x: (earA.x + earB.x) / 2, y: (earA.y + earB.y) / 2 }
  const faceWidth = Math.max(1, Math.hypot(rightSide.x - leftSide.x, rightSide.y - leftSide.y))
  const faceHeight = Math.max(1, Math.hypot(chin.x - forehead.x, chin.y - forehead.y))

  const isHuman = (point: HeadPoint) => {
    const x = Math.round(point.x / inputWidth * (maskWidth - 1))
    const y = Math.round(point.y / inputHeight * (maskHeight - 1))
    if (x < 0 || y < 0 || x >= maskWidth || y >= maskHeight) return false
    return (confidence[y * maskWidth + x] ?? 0) >= HUMAN_CONFIDENCE_THRESHOLD
  }

  const riseStep = Math.max(1.5, faceHeight / 96)
  let lastHumanDistance = 0
  let misses = 0
  for (let distance = 0; distance <= faceHeight * 1.02; distance += riseStep) {
    const center = { x: baseCenter.x + up.x * distance, y: baseCenter.y + up.y * distance }
    // A three-pixel-wide probe avoids a hair part or a noisy mask pixel from
    // being mistaken for the top of the head.
    const occupied = isHuman(center)
      || isHuman({ x: center.x + across.x * riseStep * 1.5, y: center.y + across.y * riseStep * 1.5 })
      || isHuman({ x: center.x - across.x * riseStep * 1.5, y: center.y - across.y * riseStep * 1.5 })
    if (occupied) { lastHumanDistance = distance; misses = 0 }
    else if (distance > faceHeight * .24 && ++misses >= 4) break
  }
  if (lastHumanDistance < faceHeight * .3) return null

  const crownDistance = clamp(lastHumanDistance, faceHeight * .34, faceHeight * .98)
  const samples = 16
  const left: HeadPoint[] = []
  const right: HeadPoint[] = []
  const scanStep = Math.max(1.25, faceWidth / 120)
  const scanLimit = faceWidth * 1.08
  // Keep the measured HumanSeg contour intact. The renderer adds a small,
  // bubble-sized overflow itself, instead of inflating this tracking shape.
  const padding = 0

  for (let index = 0; index < samples; index += 1) {
    const progress = index / (samples - 1)
    // Stop just below the final silhouette pixel. Keeping a little measurable
    // width at the crown creates a smooth joint with the tall foam column.
    const distance = crownDistance * progress * .965
    const center = { x: baseCenter.x + up.x * distance, y: baseCenter.y + up.y * distance }
    let minimum = Number.POSITIVE_INFINITY
    let maximum = Number.NEGATIVE_INFINITY
    const slots = Math.floor(scanLimit / scanStep)
    const occupied = Array.from({ length: slots * 2 + 1 }, (_, slot) => {
      const offset = (slot - slots) * scanStep
      return isHuman({ x: center.x + across.x * offset, y: center.y + across.y * offset })
    })
    let seed = slots
    if (!occupied[seed]) {
      seed = -1
      for (let gap = 1; gap <= Math.ceil(faceWidth * .14 / scanStep); gap += 1) {
        if (occupied[slots - gap]) { seed = slots - gap; break }
        if (occupied[slots + gap]) { seed = slots + gap; break }
      }
    }
    if (seed >= 0) {
      let leftEdge = seed; let rightEdge = seed; let empty = 0
      for (let slot = seed - 1; slot >= 0; slot -= 1) {
        if (occupied[slot]) { leftEdge = slot; empty = 0 }
        else if (++empty >= 3) break
      }
      empty = 0
      for (let slot = seed + 1; slot < occupied.length; slot += 1) {
        if (occupied[slot]) { rightEdge = slot; empty = 0 }
        else if (++empty >= 3) break
      }
      minimum = (leftEdge - slots) * scanStep
      maximum = (rightEdge - slots) * scanStep
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null
    let leftOffset = minimum - padding
    let rightOffset = maximum + padding
    leftOffset = clamp(leftOffset, -faceWidth * 1.02, -faceWidth * .035)
    rightOffset = clamp(rightOffset, faceWidth * .035, faceWidth * 1.02)
    left.push(screenPoint({ x: center.x + across.x * leftOffset, y: center.y + across.y * leftOffset }, options))
    right.push(screenPoint({ x: center.x + across.x * rightOffset, y: center.y + across.y * rightOffset }, options))
  }

  const top = screenPoint({ x: baseCenter.x + up.x * crownDistance, y: baseCenter.y + up.y * crownDistance }, options)
  // Face-oval landmarks from one upper ear, through both temples and the
  // centre of the forehead, to the other upper ear. This is the lower edge of
  // the lather, so no foam can droop into the eyes or the middle of the face.
  const hairlineIndices = [356, 389, 251, 284, 332, 297, 338, 10, 109, 67, 103, 54, 21, 162, 127]
  let hairline = hairlineIndices
    .map(index => landmarks[index])
    .filter((point): point is HeadPoint => !!point)
    .map(point => screenPoint(pixel(point), options))
  if (hairline.length < 3) return null
  const startDistance = Math.hypot(hairline[0].x - right[0].x, hairline[0].y - right[0].y)
  const endDistance = Math.hypot(hairline.at(-1)!.x - right[0].x, hairline.at(-1)!.y - right[0].y)
  if (endDistance < startDistance) hairline.reverse()
  return { left, right, top, hairline, seen: options.now, source: 'human-seg' }
}

export function smoothHeadShape(previous: HeadShape | null, next: HeadShape, amount = .5): HeadShape {
  if (!previous || previous.left.length !== next.left.length || previous.source !== next.source) return next
  const point = (from: HeadPoint, to: HeadPoint) => ({ x: mix(from.x, to.x, amount), y: mix(from.y, to.y, amount) })
  return {
    left: next.left.map((value, index) => point(previous.left[index], value)),
    right: next.right.map((value, index) => point(previous.right[index], value)),
    top: point(previous.top, next.top),
    hairline: next.hairline.length === previous.hairline.length
      ? next.hairline.map((value, index) => point(previous.hairline[index], value))
      : next.hairline,
    seen: next.seen,
    source: next.source,
  }
}
