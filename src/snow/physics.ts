import { clamp } from './types'
import { SNOW_LIMIT } from './simulation-protocol'
import type { BodyField } from './body-field'
export type Snowflake = { x: number; y: number; vx: number; vy: number; radius: number; age: number; phase: number; spin: number; angle: number; contact: boolean }

export class SnowPhysics {
  flakes: Snowflake[] = []
  width = 1; height = 1
  private accumulator = 0
  private time = 0
  private buckets = new Map<number, number[]>()
  private bucketPool: number[][] = []
  private usedBuckets: number[][] = []
  private contactResult = { distance: 0, nx: 0, ny: 0, vx: 0, vy: 0 }
  readonly limit: number
  constructor(limit = SNOW_LIMIT) { this.limit = Math.max(1, Math.min(SNOW_LIMIT, Math.floor(limit))) }
  resize(width: number, height: number) {
    const sx = width / this.width, sy = height / this.height
    for (const p of this.flakes) { p.x *= sx; p.y *= sy; p.vx *= sx; p.vy *= sy }
    this.width = width; this.height = height
  }
  clear() { this.flakes = []; this.accumulator = 0 }
  emit(x: number, y: number, span: number, count: number) {
    // The limit includes falling and accumulated snow. Never allocate over the
    // budget or delete an existing pile to make room for a new emission.
    count = Math.min(Math.max(0, Math.floor(count)), this.limit - this.flakes.length)
    if (count <= 0) return
    const size = clamp(Math.min(this.width, this.height) / 650, .65, 1.25)
    for (let i = 0; i < count; i++) this.flakes.push({
      x: x + (Math.random() - .5) * span, y: y + Math.random() * 7,
      vx: (Math.random() - .5) * 16, vy: 5 + Math.random() * 15, radius: (1.9 + Math.random() * 2.4) * size,
      age: 0, phase: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * .8, angle: Math.random() * Math.PI, contact: false,
    })
  }
  get falling() { return this.flakes.some(p => !p.contact && p.vy > 4) }
  step(delta: number, body: BodyField, now: number) {
    this.accumulator += Math.min(delta, .06)
    while (this.accumulator >= 1 / 120) { this.substep(1 / 120, body, now); this.accumulator -= 1 / 120 }
    let kept = 0
    for (let i = 0; i < this.flakes.length; i++) {
      const p = this.flakes[i]
      if (p.y < this.height + 35 && p.x > -70 && p.x < this.width + 70 && p.age < 38) this.flakes[kept++] = p
    }
    this.flakes.length = kept
  }
  private bodyCollision(p: Snowflake, body: BodyField, now: number) {
    const hit = body.contact(p.x, p.y, p.radius, now, this.contactResult)
    if (!hit) return
    const depth = Math.max(0, p.radius - hit.distance)
    // Project onto the silhouette, then exchange impulses with the moving body.
    p.x += hit.nx * depth; p.y += hit.ny * depth
    const rvx = p.vx - hit.vx, rvy = p.vy - hit.vy
    const inward = rvx * hit.nx + rvy * hit.ny
    if (inward < 0) {
      const bounce = inward < -100 ? .08 : 0
      const normalImpulse = -(1 + bounce) * inward
      p.vx += hit.nx * normalImpulse; p.vy += hit.ny * normalImpulse
      const tx = -hit.ny, ty = hit.nx
      const tangential = (p.vx - hit.vx) * tx + (p.vy - hit.vy) * ty
      // Static friction holds shallow slopes; kinetic friction permits steep
      // shoulder/arm edges to shed snow under gravity instead of gluing it on.
      const friction = Math.abs(tangential) <= .82 * normalImpulse ? tangential
        : Math.sign(tangential) * Math.min(Math.abs(tangential), .54 * normalImpulse)
      p.vx -= tx * friction; p.vy -= ty * friction
    }
    if (hit.ny < -.18) p.contact = true
  }
  private substep(dt: number, body: BodyField, now: number) {
    this.time += dt
    for (const p of this.flakes) {
      p.age += dt
      // Air resistance yields a slow terminal speed while lateral breeze and
      // flutter give light snow a drifting, rather than rain-like, descent.
      p.vx += (Math.sin(this.time * .65 + p.phase) * 16 - p.vx * 1.4) * dt
      p.vy += (260 - p.vy * (2.7 + 2 / p.radius)) * dt
      p.x += p.vx * dt; p.y += p.vy * dt
      p.angle += p.spin * dt; p.contact = false
      this.bodyCollision(p, body, now)
    }
    // Snow-snow contacts create physical piles above the HumanSeg boundary.
    // Reuse buckets without changing insertion order or contact resolution.
    // The 120Hz solver used to allocate hundreds of short arrays per substep.
    const buckets = this.buckets
    for (const bucket of this.usedBuckets) { bucket.length = 0; this.bucketPool.push(bucket) }
    this.usedBuckets.length = 0; buckets.clear()
    const cell = 12, stride = Math.ceil(this.width / cell) + 32
    for (let i = 0; i < this.flakes.length; i++) {
      const p = this.flakes[i], key = Math.floor(p.x / cell) + Math.floor(p.y / cell) * stride
      const list = buckets.get(key)
      if (list) list.push(i)
      else {
        const bucket = this.bucketPool.pop() ?? []
        bucket.push(i); buckets.set(key, bucket); this.usedBuckets.push(bucket)
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.flakes.length; i++) {
        const a = this.flakes[i], gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell)
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const neighbors = buckets.get(gx + ox + (gy + oy) * stride)
          if (!neighbors) continue
          for (const j of neighbors) {
            if (j <= i) continue
            const b = this.flakes[j], dx = b.x - a.x, dy = b.y - a.y, sum = a.radius + b.radius
            const squared = dx * dx + dy * dy
            if (squared > (sum + .15) ** 2) continue
            const distance = Math.sqrt(squared), nx = distance > .001 ? dx / distance : 0, ny = distance > .001 ? dy / distance : 1
            const ia = 1 / (a.radius * a.radius), ib = 1 / (b.radius * b.radius), total = ia + ib
            const correction = Math.max(0, sum - distance) * .9 / total
            a.x -= nx * correction * ia; a.y -= ny * correction * ia
            b.x += nx * correction * ib; b.y += ny * correction * ib
            const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
            if (approach < 0) {
              const impulse = -approach / total
              a.vx -= nx * impulse * ia; a.vy -= ny * impulse * ia
              b.vx += nx * impulse * ib; b.vy += ny * impulse * ib
              const tx = -ny, ty = nx, slip = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty
              const friction = clamp(-slip / total, -.68 * impulse, .68 * impulse)
              a.vx -= tx * friction * ia; a.vy -= ty * friction * ia
              b.vx += tx * friction * ib; b.vy += ty * friction * ib
            }
            if (ny > .2 && b.contact) a.contact = true
            if (ny < -.2 && a.contact) b.contact = true
          }
        }
      }
      for (const p of this.flakes) this.bodyCollision(p, body, now)
    }
  }
}
