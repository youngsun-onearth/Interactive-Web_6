import { clamp } from './types'
import type { HumanMask, Point } from './types'
export type BodyContact = { distance: number; nx: number; ny: number; vx: number; vy: number }

// A screen-space signed distance field follows the actual HumanSeg silhouette,
// including arms, shoulder slopes and the gaps around the person.
export class BodyField {
  width = 1; height = 1; cols = 2; rows = 2; cellX = 1; cellY = 1
  private occupied = new Uint8Array(4)
  private distances = new Float32Array(4).fill(10000)
  private seen = -Infinity
  private centroid: Point | null = null
  private motion = { x: 0, y: 0 }

  resize(width: number, height: number) {
    this.width = width; this.height = height
    const scale = 224 / Math.max(width, height)
    this.cols = Math.max(8, Math.round(width * scale)); this.rows = Math.max(8, Math.round(height * scale))
    this.cellX = width / (this.cols - 1); this.cellY = height / (this.rows - 1)
    this.occupied = new Uint8Array(this.cols * this.rows)
    this.distances = new Float32Array(this.occupied.length).fill(10000)
    this.seen = -Infinity; this.centroid = null; this.motion = { x: 0, y: 0 }
  }
  clear() { this.seen = -Infinity; this.centroid = null; this.motion = { x: 0, y: 0 }; this.occupied.fill(0); this.distances.fill(10000) }

  update(mask: HumanMask, sourceWidth: number, sourceHeight: number, now: number) {
    if (mask.values.length !== mask.width * mask.height || sourceWidth < 1 || sourceHeight < 1) return
    const scale = Math.max(this.width / sourceWidth, this.height / sourceHeight)
    let count = 0, sumX = 0, sumY = 0
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const index = y * this.cols + x
      const u = .5 - (x * this.cellX - this.width / 2) / (sourceWidth * scale)
      const v = .5 + (y * this.cellY - this.height / 2) / (sourceHeight * scale)
      const mx = clamp(u * (mask.width - 1), 0, mask.width - 1), my = clamp(v * (mask.height - 1), 0, mask.height - 1)
      const left = Math.floor(mx), top = Math.floor(my), right = Math.min(left + 1, mask.width - 1), bottom = Math.min(top + 1, mask.height - 1)
      const fx = mx - left, fy = my - top
      const confidence = ((mask.values[top * mask.width + left] * (1 - fx) + mask.values[top * mask.width + right] * fx) * (1 - fy)
        + (mask.values[bottom * mask.width + left] * (1 - fx) + mask.values[bottom * mask.width + right] * fx) * fy) / 255
      this.occupied[index] = confidence >= (this.occupied[index] ? .43 : .56) ? 1 : 0
      if (this.occupied[index]) { count++; sumX += x * this.cellX; sumY += y * this.cellY }
    }
    const nextCenter = count ? { x: sumX / count, y: sumY / count } : null
    const dt = (now - this.seen) / 1000
    if (nextCenter && this.centroid && dt > .04 && dt < .7) {
      this.motion.x = clamp((nextCenter.x - this.centroid.x) / dt, -400, 400)
      this.motion.y = clamp((nextCenter.y - this.centroid.y) / dt, -400, 400)
    } else this.motion = { x: 0, y: 0 }
    this.centroid = nextCenter; this.seen = now
    if (!count) { this.distances.fill(10000); return }
    const d = this.distances, w = this.cols, h = this.rows
    d.fill(10000)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, label = this.occupied[i]
      if ((x > 0 && this.occupied[i - 1] !== label) || (x + 1 < w && this.occupied[i + 1] !== label)
        || (y > 0 && this.occupied[i - w] !== label) || (y + 1 < h && this.occupied[i + w] !== label)) d[i] = 0
    }
    const diagonal = Math.hypot(this.cellX, this.cellY)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x) d[i] = Math.min(d[i], d[i - 1] + this.cellX)
      if (y) d[i] = Math.min(d[i], d[i - w] + this.cellY)
      if (x && y) d[i] = Math.min(d[i], d[i - w - 1] + diagonal)
      if (x + 1 < w && y) d[i] = Math.min(d[i], d[i - w + 1] + diagonal)
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (x + 1 < w) d[i] = Math.min(d[i], d[i + 1] + this.cellX)
      if (y + 1 < h) d[i] = Math.min(d[i], d[i + w] + this.cellY)
      if (x + 1 < w && y + 1 < h) d[i] = Math.min(d[i], d[i + w + 1] + diagonal)
      if (x && y + 1 < h) d[i] = Math.min(d[i], d[i + w - 1] + diagonal)
    }
    const halfCell = Math.min(this.cellX, this.cellY) / 2
    for (let i = 0; i < d.length; i++) d[i] = (d[i] + halfCell) * (this.occupied[i] ? -1 : 1)
  }
  distance(x: number, y: number, now: number) {
    if (now - this.seen > 750 || x < 0 || x > this.width || y < 0 || y > this.height) return 10000
    const gx = clamp(x / this.cellX, 0, this.cols - 1), gy = clamp(y / this.cellY, 0, this.rows - 1)
    const left = Math.floor(gx), top = Math.floor(gy), right = Math.min(this.cols - 1, left + 1), bottom = Math.min(this.rows - 1, top + 1)
    const fx = gx - left, fy = gy - top, d = this.distances, w = this.cols
    return (d[top * w + left] * (1 - fx) + d[top * w + right] * fx) * (1 - fy)
      + (d[bottom * w + left] * (1 - fx) + d[bottom * w + right] * fx) * fy
  }
  contact(x: number, y: number, radius: number, now: number, result?: BodyContact) {
    const distance = this.distance(x, y, now)
    if (distance >= radius + .25) return null
    const h = Math.max(1, Math.min(this.cellX, this.cellY) * .6)
    const dx = this.distance(x + h, y, now) - this.distance(x - h, y, now)
    const dy = this.distance(x, y + h, now) - this.distance(x, y - h, now)
    const length = Math.hypot(dx, dy)
    if (length < 1e-5) return null
    const motionFade = 1 - clamp((now - this.seen - 100) / 260)
    const contact = result ?? { distance: 0, nx: 0, ny: 0, vx: 0, vy: 0 }
    contact.distance = distance; contact.nx = dx / length; contact.ny = dy / length
    contact.vx = this.motion.x * motionFade; contact.vy = this.motion.y * motionFade
    return contact
  }
}
