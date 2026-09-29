export type Point = { x: number; y: number; z?: number }
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

// Finger joint angles, measured in world space, do not depend on screen rotation.
export function isClosedFist(points: Point[], wasClosed = false) {
  if (points.length < 21) return false
  const bend = (a: Point, b: Point, c: Point) => {
    const u = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)]
    const v = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)]
    return (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.max(1e-8, Math.hypot(...u) * Math.hypot(...v))
  }
  const curled = [5, 9, 13, 17].filter((base) => bend(points[base], points[base + 1], points[base + 3]) > (wasClosed ? -0.65 : -0.35))
  return curled.length >= 3
}

// Canvas uses object-fit: cover. Input points are already mirrored by the inference canvas.
export function coverPoint(point: Point, sourceWidth: number, sourceHeight: number, width: number, height: number): Point {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  return { x: (point.x - 0.5) * sourceWidth * scale + width / 2, y: (point.y - 0.5) * sourceHeight * scale + height / 2 }
}

// Swept collision against a moving rim prevents fast drops and moving cups tunnelling.
export function entersCup(previous: Point, next: Point, oldCup: Point, cup: Point, halfOpening: number) {
  const before = previous.y - oldCup.y
  const after = next.y - cup.y
  if (before > 0 || after < 0 || after <= before) return false
  const t = -before / (after - before)
  const dropX = previous.x + (next.x - previous.x) * t
  const rimX = oldCup.x + (cup.x - oldCup.x) * t
  return Math.abs(dropX - rimX) < halfOpening
}
