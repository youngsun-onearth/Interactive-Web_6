// A small height field keeps the simulation independent of camera resolution.
export class WaterSurface {
  readonly width: number
  readonly height: number
  current: Float32Array
  private previous: Float32Array
  private next: Float32Array
  readonly normals: Uint8Array
  private dirty = true
  private moving = false
  private revision = 0

  constructor(aspect: number, resolution = 180) {
    this.width = Math.max(24, Math.round(aspect >= 1 ? resolution : resolution * aspect))
    this.height = Math.max(24, Math.round(aspect >= 1 ? resolution / aspect : resolution))
    const length = this.width * this.height
    this.current = new Float32Array(length)
    this.previous = new Float32Array(length)
    this.next = new Float32Array(length)
    this.normals = new Uint8Array(length * 4)
    this.encode()
  }

  disturb(x: number, y: number, fromX = x, fromY = y, strength = -0.075, radius = 3) {
    const dx = (x - fromX) * this.width
    const dy = (y - fromY) * this.height
    const steps = Math.min(32, Math.max(1, Math.ceil(Math.hypot(dx, dy))))
    const size = Math.max(1, Math.round(radius))
    const radiusSquared = size * size
    let changed = false
    for (let step = 1; step <= steps; step++) {
      const cx = fromX * this.width + dx * step / steps
      const cy = fromY * this.height + dy * step / steps
      for (let oy = -size; oy <= size; oy++) for (let ox = -size; ox <= size; ox++) {
        const px = Math.round(cx) + ox; const py = Math.round(cy) + oy
        if (px < 2 || py < 2 || px >= this.width - 2 || py >= this.height - 2) continue
        const r2 = (px - cx) ** 2 + (py - cy) ** 2
        if (r2 > radiusSquared) continue
        const i = py * this.width + px
        this.current[i] = Math.max(-1, Math.min(1, this.current[i] + strength * Math.exp(-r2 / Math.max(1, radiusSquared / 3))))
        changed = true
      }
    }
    if (changed) { this.dirty = true; this.moving = true }
  }

  step(extraDamping = 1) {
    if (!this.moving) return
    const w = this.width; const h = this.height
    let peak = 0
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const laplacian = this.current[i - 1] + this.current[i + 1] + this.current[i - w] + this.current[i + w] - 4 * this.current[i]
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y)
      const damping = edge < 6 ? 0.90 + edge * 0.016 : 0.994
      this.next[i] = (2 * this.current[i] - this.previous[i] + 0.45 * laplacian) * damping * extraDamping
      peak = Math.max(peak, Math.abs(this.current[i]), Math.abs(this.next[i]))
    }
    const spare = this.previous
    this.previous = this.current; this.current = this.next; this.next = spare
    // Below this threshold no 8-bit normal can change, so snapping to rest
    // keeps the rendered image identical while ending idle simulation work.
    if (peak < .0001) {
      this.current.fill(0); this.previous.fill(0); this.next.fill(0)
      this.moving = false
    }
    this.dirty = true
  }

  encode() {
    if (!this.dirty) return this.normals
    const w = this.width; const h = this.height
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dx = this.current[y * w + Math.min(w - 1, x + 1)] - this.current[y * w + Math.max(0, x - 1)]
      const dy = this.current[Math.min(h - 1, y + 1) * w + x] - this.current[Math.max(0, y - 1) * w + x]
      this.normals[i * 4] = Math.max(0, Math.min(255, Math.round(128 + dx * 190)))
      this.normals[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + dy * 190)))
      this.normals[i * 4 + 2] = 128
      this.normals[i * 4 + 3] = 255
    }
    this.dirty = false
    this.revision++
    return this.normals
  }

  get version() { return this.revision }
}
