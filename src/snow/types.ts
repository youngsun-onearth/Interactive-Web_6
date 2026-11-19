export type Point = { x: number; y: number; z?: number }
export type HumanMask = { width: number; height: number; values: Uint8Array }
export type TrackedHand = { id: string; landmarks: Point[]; world: Point[] }
export type TrackingMessage = { type: 'ready' } | { type: 'error'; message: string } | {
  type: 'result'; timestamp: number; hands: TrackedHand[]; face: Point[]; body?: HumanMask
}
export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value))
export function screenPoint(point: Point, sourceWidth: number, sourceHeight: number, width: number, height: number): Point {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  return { x: (.5 - point.x) * sourceWidth * scale + width / 2, y: (point.y - .5) * sourceHeight * scale + height / 2 }
}
export function indexExtended(points: Point[]) {
  if (points.length < 21) return false
  const a = points[5], b = points[6], c = points[8], wrist = points[0]
  const u = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)]
  const v = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)]
  const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.max(1e-8, Math.hypot(...u) * Math.hypot(...v))
  return cosine < -.60 && Math.hypot(c.x - wrist.x, c.y - wrist.y, (c.z ?? 0) - (wrist.z ?? 0))
    > Math.hypot(b.x - wrist.x, b.y - wrist.y, (b.z ?? 0) - (wrist.z ?? 0)) * 1.12
}
