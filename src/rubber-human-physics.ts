export type RubberPoint = { x: number; y: number }

export type ElasticPoint = {
  x: number
  y: number
  vx: number
  vy: number
}

export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export function pointInPolygon(point: RubberPoint, polygon: RubberPoint[]) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y || Number.EPSILON) + currentPoint.x

    if (crosses) inside = !inside
  }

  return inside
}

// A quintic falloff has zero slope at both ends. Adjacent face-mesh vertices
// therefore meet without a visible hard edge while the pinched center follows
// the hand at full strength.
export function rubberWeight(distance: number, radius: number) {
  const t = clamp(1 - distance / Math.max(1, radius), 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function limitVector(point: RubberPoint, maximum: number): RubberPoint {
  const length = Math.hypot(point.x, point.y)
  if (length <= maximum || length === 0) return point
  const scale = maximum / length
  return { x: point.x * scale, y: point.y * scale }
}

export function stepElastic(
  state: ElasticPoint,
  target: RubberPoint,
  deltaTime: number,
  stiffness: number,
  damping: number,
) {
  // Substeps keep the spring stable after a temporarily delayed animation frame.
  const steps = Math.max(1, Math.ceil(deltaTime / (1 / 120)))
  const step = deltaTime / steps

  for (let index = 0; index < steps; index += 1) {
    state.vx += (target.x - state.x) * stiffness * step
    state.vy += (target.y - state.y) * stiffness * step
    const drag = Math.exp(-damping * step)
    state.vx *= drag
    state.vy *= drag
    state.x += state.vx * step
    state.y += state.vy * step
  }
}
