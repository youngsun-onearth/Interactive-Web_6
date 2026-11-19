import { BodyField } from './body-field'
import { SnowPhysics } from './physics'
import { SNOW_LIMIT, SNAPSHOT_STRIDE } from './simulation-protocol'
import type { BodyUpdate, SnowEmission, SimulationInput, SimulationOutput } from './simulation-protocol'
import type { HumanMask } from './types'

export type VisibleSnowflake = { x: number; y: number; radius: number; age: number; angle: number }
type ParticleView = VisibleSnowflake & { targetX: number; targetY: number; targetAngle: number; seen: number }

// Render the same sprites on the UI thread while the silhouette distance field
// and the unchanged 120Hz collision solver run independently in a worker.
export class SnowSimulation {
  readonly limit: number
  flakes: VisibleSnowflake[] = []
  private worker: Worker | null = null
  private width = 1; private height = 1
  private active = false; private ready = false; private pending = false
  private revision = 0; private snapshot = 0; private elapsed = 0
  private emissions: SnowEmission[] = []
  private queuedSnow = 0
  private recycle: ArrayBuffer | undefined
  private pendingBody: BodyUpdate | undefined
  private particles = new Map<number, ParticleView>()
  private fallingSnow = false
  private fallback: { body: BodyField; physics: SnowPhysics } | null = null
  private workerFailed = false
  private initializationTimer = 0

  constructor(limit = SNOW_LIMIT) { this.limit = Math.max(1, Math.min(SNOW_LIMIT, Math.floor(limit))) }
  get falling() { return this.fallback ? this.fallback.physics.falling : this.fallingSnow }
  get running() { return this.worker !== null || this.fallback !== null }
  start() {
    if (this.active) return
    this.active = true
    if (this.workerFailed || typeof Worker === 'undefined') { this.useFallback(); return }
    try {
      const candidate = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' })
      this.worker = candidate
      this.initializationTimer = window.setTimeout(() => { if (this.worker === candidate && !this.ready) this.useFallback() }, 15000)
      candidate.onerror = event => { if (this.worker === candidate) this.useFallback(event.message) }
      candidate.onmessage = (event: MessageEvent<SimulationOutput>) => {
        if (!this.active || this.worker !== candidate || event.data.revision !== this.revision) return
        const message = event.data
        if (message.type === 'error') { this.useFallback(message.message); return }
        if (message.type === 'ready') { clearTimeout(this.initializationTimer); this.ready = true; return }
        this.pending = false; this.fallingSnow = message.falling
        const stamp = ++this.snapshot, data = message.positions
        let visible = 0
        for (let i = 0; i < Math.min(message.count, this.limit); i++) {
          const offset = i * SNAPSHOT_STRIDE, id = data[offset]
          let particle = this.particles.get(id)
          if (!particle) {
            particle = { x: data[offset + 1], y: data[offset + 2], targetX: data[offset + 1], targetY: data[offset + 2],
              radius: data[offset + 3], age: data[offset + 4], angle: data[offset + 5], targetAngle: data[offset + 5], seen: stamp }
            this.particles.set(id, particle)
          }
          particle.targetX = data[offset + 1]; particle.targetY = data[offset + 2]
          particle.radius = data[offset + 3]; particle.age = data[offset + 4]; particle.targetAngle = data[offset + 5]; particle.seen = stamp
          this.flakes[visible++] = particle
        }
        this.flakes.length = visible
        for (const [id, particle] of this.particles) if (particle.seen !== stamp) this.particles.delete(id)
        // The numbers have been copied into reusable view objects. Return the
        // backing buffer with the next tick instead of allocating every frame.
        this.recycle = data.buffer as ArrayBuffer
      }
      this.post({ type: 'init', width: this.width, height: this.height, limit: this.limit, revision: this.revision })
    } catch (error) { this.useFallback(error) }
  }
  stop() {
    this.active = false; ++this.revision; clearTimeout(this.initializationTimer)
    this.worker?.terminate(); this.worker = null; this.ready = false; this.pending = false
    this.fallback?.physics.clear(); this.fallback?.body.clear(); this.fallback = null
    this.clearViews()
  }
  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return
    const sx = width / this.width, sy = height / this.height
    this.width = width; this.height = height; ++this.revision
    this.pending = false; this.ready = false; this.recycle = undefined; this.pendingBody = undefined
    for (const particle of this.particles.values()) {
      particle.x *= sx; particle.targetX *= sx; particle.y *= sy; particle.targetY *= sy
    }
    if (this.worker) this.post({ type: 'resize', width, height, revision: this.revision })
    if (this.fallback) { this.fallback.physics.resize(width, height); this.fallback.body.resize(width, height) }
  }
  clear() {
    ++this.revision; this.pending = false; this.recycle = undefined; this.clearViews()
    this.fallback?.physics.clear(); this.fallback?.body.clear()
    if (this.worker) { this.ready = false; this.post({ type: 'clear', revision: this.revision }) }
  }
  clearBody() {
    // Release is used when tracking disappears; an empty mask removes support
    // immediately without retaining an obsolete outline under settled snow.
    this.updateBody({ width: 2, height: 2, values: new Uint8Array(4) }, this.width, this.height, performance.now())
  }
  updateBody(body: HumanMask, sourceWidth: number, sourceHeight: number, timestamp: number) {
    if (this.fallback) { this.fallback.body.update(body, sourceWidth, sourceHeight, timestamp); return }
    // Coalesce masks while the solver is busy: process the latest silhouette,
    // rather than building a queue of expensive obsolete distance fields.
    if (this.worker) this.pendingBody = { body, sourceWidth, sourceHeight, timestamp }
  }
  emit(x: number, y: number, span: number, count: number) {
    if (!this.active) return
    if (this.fallback) { this.fallback.physics.emit(x, y, span, count); return }
    const accepted = Math.min(Math.max(0, Math.floor(count)), Math.max(0, this.limit - this.flakes.length - this.queuedSnow))
    if (!accepted || this.emissions.length >= 32) return
    this.emissions.push({ x, y, span, count: accepted }); this.queuedSnow += accepted
  }
  step(delta: number, now: number) {
    if (!this.active) return
    if (this.fallback) {
      this.fallback.physics.step(delta, this.fallback.body, now)
      this.flakes = this.fallback.physics.flakes; return
    }
    if (!this.pending && !this.flakes.length && !this.emissions.length) {
      this.elapsed = 0
      return
    }
    this.elapsed = Math.min(.06, this.elapsed + delta)
    if (this.worker && this.ready && !this.pending) {
      const recycle = this.recycle
      const message: SimulationInput = { type: 'step', delta: this.elapsed, timestamp: now,
        emissions: this.emissions, bodyUpdate: this.pendingBody, recycle, revision: this.revision }
      const transfer: Transferable[] = []
      if (recycle) transfer.push(recycle)
      if (this.pendingBody) transfer.push(this.pendingBody.body.values.buffer as ArrayBuffer)
      this.pending = true
      this.post(message, transfer)
      this.pendingBody = undefined
      this.recycle = undefined; this.elapsed = 0; this.emissions = []; this.queuedSnow = 0
    }
    // Interpolate display positions rather than snapping all piled snow to a
    // newly detected outline at once. Sprite size, shape and rotation remain.
    const blend = 1 - Math.exp(-delta * 40)
    for (const particle of this.particles.values()) {
      particle.x += (particle.targetX - particle.x) * blend
      particle.y += (particle.targetY - particle.y) * blend
      particle.angle += (particle.targetAngle - particle.angle) * blend
    }
  }
  private clearViews() {
    this.flakes = []; this.particles.clear(); this.fallingSnow = false
    this.recycle = undefined; this.pendingBody = undefined; this.elapsed = 0; this.emissions = []; this.queuedSnow = 0
  }
  private useFallback(error?: unknown) {
    if (!this.active) return
    if (error) console.warn('Snow simulation worker unavailable; using the bounded local solver.', error)
    clearTimeout(this.initializationTimer); this.worker?.terminate(); this.worker = null
    this.workerFailed = true; this.ready = false; this.pending = false
    const physics = new SnowPhysics(this.limit), body = new BodyField()
    physics.resize(this.width, this.height); body.resize(this.width, this.height)
    if (this.pendingBody?.body.values.length) {
      const update = this.pendingBody
      body.update(update.body, update.sourceWidth, update.sourceHeight, update.timestamp)
    }
    for (const emission of this.emissions) physics.emit(emission.x, emission.y, emission.span, emission.count)
    this.clearViews(); this.fallback = { physics, body }; this.flakes = physics.flakes
  }
  private post(message: SimulationInput, transfer: Transferable[] = []) {
    try { this.worker?.postMessage(message, transfer) }
    catch (error) { this.useFallback(error) }
  }
}
