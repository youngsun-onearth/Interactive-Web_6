import { clamp } from './types'
import type { Point } from './types'
export type Cloud = { x: number; y: number; radius: number; phase: number; anchorX: number; anchorY: number; rainUntil: number; poked: number; emitting: number; touching: Set<string> }

function cloudSprite() {
  const canvas = document.createElement('canvas'); canvas.width = 1104; canvas.height = 824
  const ctx = canvas.getContext('2d')!
  // Oversample the artwork and reserve padding for every soft shadow edge.
  ctx.scale(2, 2); ctx.translate(96, 96)
  ctx.shadowColor = 'rgba(139,177,205,.45)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 9
  const shade = ctx.createLinearGradient(0, 35, 0, 180)
  shade.addColorStop(0, '#ffffff'); shade.addColorStop(.55, '#f4faff'); shade.addColorStop(1, '#bed6e8')
  ctx.fillStyle = shade
  ctx.beginPath(); ctx.moveTo(67, 168)
  ctx.bezierCurveTo(10, 165, 12, 92, 68, 91)
  ctx.bezierCurveTo(64, 35, 123, 12, 157, 48)
  ctx.bezierCurveTo(187, 4, 258, 24, 262, 76)
  ctx.bezierCurveTo(329, 56, 356, 127, 313, 159)
  ctx.bezierCurveTo(282, 185, 109, 185, 67, 168); ctx.closePath(); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(70, 99); ctx.bezierCurveTo(83, 72, 126, 70, 146, 89); ctx.stroke()
  return canvas
}
export class CloudSky {
  clouds: Cloud[] = []
  private sprite = cloudSprite()
  resize(width: number, height: number) {
    const count = width < 600 ? 4 : 5, columns = width < 600 ? 2 : 3
    const maximum = Math.min(128, height * .28)
    const radius = clamp(width / (columns * 2.35), Math.min(62, maximum), maximum)
    // The artwork's visible top is about .56 radii above its center.
    // Leave only a small screen-edge gap, independent of menu height.
    const top = 10 + radius * .58
    const sway = Math.min(10, radius * .08)
    const margin = Math.min(width / 2, radius * 1.12 + sway + 8)
    this.clouds = Array.from({ length: count }, (_, i) => {
      const anchorX = margin + i / (count - 1) * Math.max(0, width - margin * 2)
      const anchorY = top
      const previous = this.clouds[i]
      return { x: anchorX, y: anchorY, anchorX, anchorY, radius, phase: i * 1.9,
        rainUntil: previous?.rainUntil ?? 0, poked: previous?.poked ?? -Infinity,
        emitting: previous?.emitting ?? 0, touching: previous?.touching ?? new Set<string>(),
      }
    })
  }
  reset() { for (const cloud of this.clouds) { cloud.rainUntil = 0; cloud.emitting = 0; cloud.touching.clear() } }
  update(_dt: number, now: number) {
    for (const cloud of this.clouds) {
      cloud.x = cloud.anchorX + Math.sin(now * .00025 + cloud.phase) * Math.min(10, cloud.radius * .08)
      cloud.y = cloud.anchorY
    }
  }
  poke(id: string, from: Point, to: Point, now: number) {
    for (const cloud of this.clouds) {
      const ax = (from.x - cloud.x) / cloud.radius, ay = (from.y - cloud.y) / (cloud.radius * .54)
      const dx = (to.x - from.x) / cloud.radius, dy = (to.y - from.y) / (cloud.radius * .54)
      const t = clamp(-(ax * dx + ay * dy) / Math.max(1e-8, dx * dx + dy * dy))
      const crossing = Math.hypot(ax + dx * t, ay + dy * t) < 1
      const inside = Math.hypot((to.x - cloud.x) / cloud.radius, (to.y - cloud.y) / (cloud.radius * .54)) < 1
      if (crossing && !cloud.touching.has(id) && now - cloud.poked > 650) {
        cloud.rainUntil = now + 6500; cloud.poked = now
      }
      if (inside) cloud.touching.add(id); else cloud.touching.delete(id)
    }
  }
  release(id: string) { for (const cloud of this.clouds) cloud.touching.delete(id) }
  get snowing() { return this.clouds.some(c => c.rainUntil > performance.now()) }
  emit(dt: number, now: number, spawn: (x: number, y: number, span: number, count: number) => void) {
    for (const cloud of this.clouds) {
      if (now >= cloud.rainUntil) continue
      const ending = clamp((cloud.rainUntil - now) / 1000)
      cloud.emitting += dt * 39 * ending
      const count = Math.floor(cloud.emitting)
      if (count) { cloud.emitting -= count; spawn(cloud.x, cloud.y + cloud.radius * .34, cloud.radius * 1.45, count) }
    }
  }
  draw(ctx: CanvasRenderingContext2D, now: number) {
    for (const cloud of this.clouds) {
      const since = (now - cloud.poked) / 1000
      const squash = since < .7 ? Math.sin(since * 18) * Math.exp(-since * 6) * .16 : 0
      ctx.save(); ctx.translate(cloud.x, cloud.y); ctx.scale(1 + squash, 1)
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      const scale = cloud.radius / 150
      ctx.drawImage(this.sprite, -276 * scale, -206 * scale, 552 * scale, 412 * scale)
      if (now < cloud.rainUntil) {
        ctx.strokeStyle = '#e4f7ff'; ctx.lineWidth = 1.4; ctx.globalAlpha = .6
        const pulse = .8 + Math.sin(now * .003 + cloud.phase) * .15
        for (const offset of [-.43, 0, .43]) {
          const x = offset * cloud.radius, y = cloud.radius * .46
          ctx.beginPath(); ctx.moveTo(x - 4 * pulse, y); ctx.lineTo(x + 4 * pulse, y)
          ctx.moveTo(x, y - 4 * pulse); ctx.lineTo(x, y + 4 * pulse); ctx.stroke()
        }
      }
      ctx.restore()
    }
  }
}
