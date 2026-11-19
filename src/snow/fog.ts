import { clamp } from './types'
import type { Point } from './types'

// Density and erased strokes are separate so ongoing breath does not instantly
// repaint a drawing. Camera pixels come from one completed scene, never a
// second video read or the canvas currently receiving the fog composite.
export class FogGlass {
  private mask = document.createElement('canvas')
  private maskContext = this.mask.getContext('2d')!
  private layer = document.createElement('canvas')
  private context = this.layer.getContext('2d')!
  private reduced = document.createElement('canvas')
  private reducedContext = this.reduced.getContext('2d', { alpha: false })!
  private intermediate = document.createElement('canvas')
  private intermediateContext = this.intermediate.getContext('2d', { alpha: false })!
  private image: ImageData | null = null
  private density = new Float32Array(0)
  private erased = new Float32Array(0)
  private scaleX = 1; private scaleY = 1
  private width = 1; private height = 1
  private amount = 0
  private hasErased = false

  resize(width: number, height: number) {
    if (this.width === width && this.height === height && this.image) return
    const oldWidth = this.mask.width, oldHeight = this.mask.height
    const oldDensity = this.density, oldErased = this.erased
    this.width = width; this.height = height
    const scale = Math.min(.8, 640 / Math.max(width, height))
    this.mask.width = Math.max(2, Math.round(width * scale)); this.mask.height = Math.max(2, Math.round(height * scale))
    this.scaleX = this.mask.width / width; this.scaleY = this.mask.height / height
    const size = this.mask.width * this.mask.height
    this.density = new Float32Array(size); this.erased = new Float32Array(size)
    this.image = this.maskContext.createImageData(this.mask.width, this.mask.height)
    this.amount = 0
    this.hasErased = false
    if (oldDensity.length) {
      const sample = (field: Float32Array, left: number, top: number, right: number, bottom: number, fx: number, fy: number) =>
        (field[top * oldWidth + left] * (1 - fx) + field[top * oldWidth + right] * fx) * (1 - fy)
        + (field[bottom * oldWidth + left] * (1 - fx) + field[bottom * oldWidth + right] * fx) * fy
      // Keep condensation and writing when mobile browser chrome changes the
      // viewport height, rather than clearing the whole glass on every resize.
      for (let y = 0; y < this.mask.height; y++) for (let x = 0; x < this.mask.width; x++) {
        const sx = x / (this.mask.width - 1) * (oldWidth - 1), sy = y / (this.mask.height - 1) * (oldHeight - 1)
        const left = Math.floor(sx), top = Math.floor(sy), right = Math.min(oldWidth - 1, left + 1), bottom = Math.min(oldHeight - 1, top + 1)
        const fx = sx - left, fy = sy - top, i = y * this.mask.width + x
        this.density[i] = sample(oldDensity, left, top, right, bottom, fx, fy)
        this.erased[i] = sample(oldErased, left, top, right, bottom, fx, fy); this.amount += this.density[i]
        if (this.erased[i] > 0) this.hasErased = true
      }
    }
    const layerScale = Math.min(1, 1280 / Math.max(width, height))
    this.layer.width = Math.max(2, Math.round(width * layerScale)); this.layer.height = Math.max(2, Math.round(height * layerScale))
    this.intermediate.width = Math.max(2, Math.round(this.layer.width / 2)); this.intermediate.height = Math.max(2, Math.round(this.layer.height / 2))
    const blurScale = Math.min(1, 180 / Math.max(width, height))
    this.reduced.width = Math.max(2, Math.round(width * blurScale)); this.reduced.height = Math.max(2, Math.round(height * blurScale))
    for (const context of [this.context, this.intermediateContext, this.reducedContext]) {
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    }
  }
  clear() { this.density.fill(0); this.erased.fill(0); this.amount = 0; this.hasErased = false }
  step(dt: number) {
    if (this.amount === 0 && !this.hasErased) return
    const evaporation = Math.exp(-dt / 5.8), strokeFade = Math.exp(-dt / 9)
    this.amount = 0; this.hasErased = false
    for (let i = 0; i < this.density.length; i++) {
      this.density[i] *= evaporation; this.erased[i] *= strokeFade
      if (this.erased[i] < 1e-7) this.erased[i] = 0
      else this.hasErased = true
      if (this.density[i] < .001) this.density[i] = 0
      this.amount += this.density[i]
    }
  }
  breathe(center: Point, radius: number, dt: number) {
    const cx = center.x * this.scaleX, cy = center.y * this.scaleY
    const rx = Math.max(2, radius * this.scaleX), ry = Math.max(2, radius * .88 * this.scaleY)
    const w = this.mask.width, h = this.mask.height
    const left = Math.max(0, Math.floor(cx - rx * 2.15)), right = Math.min(w - 1, Math.ceil(cx + rx * 2.15))
    const top = Math.max(0, Math.floor(cy - ry * 2.15)), bottom = Math.min(h - 1, Math.ceil(cy + ry * 2.15))
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const r2 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      if (r2 >= 4.6) continue
      const taper = clamp((4.6 - r2) / 1.7)
      const i = y * w + x, deposit = Math.exp(-r2 * 1.2) * taper * taper * dt * 1.9 * (1 - this.erased[i])
      this.density[i] = Math.min(.95, this.density[i] + deposit); this.amount += deposit
    }
  }
  wipe(from: Point, to: Point, radius: number) {
    if (this.amount < .01) return
    const ax = from.x * this.scaleX, ay = from.y * this.scaleY, bx = to.x * this.scaleX, by = to.y * this.scaleY
    const r = Math.max(2, radius * (this.scaleX + this.scaleY) / 2), dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
    const w = this.mask.width, h = this.mask.height
    const left = Math.max(0, Math.floor(Math.min(ax, bx) - r)), right = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r))
    const top = Math.max(0, Math.floor(Math.min(ay, by) - r)), bottom = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r))
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const t = length2 ? clamp(((x - ax) * dx + (y - ay) * dy) / length2) : 0
      const distance = Math.hypot(x - ax - dx * t, y - ay - dy * t)
      const feather = clamp((1 - distance / r) / .4), strength = feather * feather * (3 - 2 * feather)
      if (!strength) continue
      const i = y * w + x
      if (this.density[i] < .008 && this.erased[i] < .01) continue
      this.density[i] *= 1 - strength; this.erased[i] = Math.max(this.erased[i], strength); this.hasErased = true
    }
  }
  draw(output: CanvasRenderingContext2D, scene: HTMLCanvasElement) {
    if (this.amount < .02 || !this.image || !scene.width || !scene.height) return
    const bytes = this.image.data
    let visible = false
    for (let i = 0; i < this.density.length; i++) {
      const alpha = this.density[i] * 225
      bytes[i * 4] = bytes[i * 4 + 1] = bytes[i * 4 + 2] = 255; bytes[i * 4 + 3] = alpha
      if (alpha > 1) visible = true
    }
    if (!visible) return
    this.maskContext.putImageData(this.image, 0, 0)
    // Progressive resampling provides a stable frosted blur without a GPU
    // canvas filter, which can leave corrupt tiles or hard texture edges.
    this.intermediateContext.drawImage(scene, 0, 0, this.intermediate.width, this.intermediate.height)
    this.reducedContext.drawImage(this.intermediate, 0, 0, this.reduced.width, this.reduced.height)
    const ctx = this.context, w = this.layer.width, h = this.layer.height
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h); ctx.drawImage(this.reduced, 0, 0, w, h)
    ctx.globalAlpha = .16
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) ctx.drawImage(this.reduced, dx - 3, dy - 3, w + 6, h + 6)
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(239,247,251,.52)'; ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(this.mask, 0, 0, w, h)
    ctx.restore()
    output.save(); output.globalAlpha = 1; output.imageSmoothingEnabled = true; output.imageSmoothingQuality = 'high'
    output.drawImage(this.layer, 0, 0, this.width, this.height); output.restore()
  }
}
