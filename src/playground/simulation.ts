// Shared deterministic playground rules. No browser, socket, or timer dependencies.
export const RIDES = {
  swing: { name: '그네', x: -6, z: -4, seats: 2, radius: 2.3, color: '#f29b76' },
  seesaw: { name: '시소', x: 6, z: -4, seats: 2, radius: 2.8, color: '#a8a2e8' },
  slide: { name: '미끄럼틀', x: -6, z: 5, seats: 1, radius: 2.5, color: '#edc65d' },
  spinner: { name: '뺑뺑이', x: 6, z: 5, seats: 6, radius: 2.5, color: '#71bcb0' },
} as const
export type RideId = keyof typeof RIDES
export const RIDE_IDS = Object.keys(RIDES) as RideId[]
export const MAX_PLAYERS = 32
export const SLIDE_CLIMB_TIME = 2.2
export const SLIDE_DURATION = 1.05
export const SEESAW_LIMIT = .5
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export type SwingState = { angle: number; velocity: number; lastPump: number }
export type Player = {
  id: string; nickname: string; outfit: number; x: number; z: number; yaw: number
  moving: boolean; riding: { id: RideId; seat: number; since: number } | null
  stamina: number; slip: number; holding: boolean; notice: string
  pumpAt: number; pumpResult: 'hit' | 'miss' | ''
}
export type World = {
  time: number; spinAngle: number; spinSpeed: number; seesawAngle: number
  seesawVelocity: number; seesawLastPump: number; swings: SwingState[]
  players: Record<string, Player>
}
export type Input = { x: number; z: number; hold: boolean }
export type Pose = { x: number; y: number; z: number; yaw: number; tilt: number }

export function createWorld(): World {
  return { time: 0, spinAngle: 0, spinSpeed: .35, seesawAngle: 0, seesawVelocity: 0,
    seesawLastPump: -10, swings: [0, 1].map(() => ({ angle: 0, velocity: 0, lastPump: -10 })), players: {} }
}

// The same path samples build the chute and move the rider, including heading.
export function slidePoint(progress: number) {
  const u = clamp(progress, 0, 1), a = Math.PI * u
  const dx = 1.35 * Math.PI * (3 * Math.cos(3 * a) * Math.sin(a) + Math.sin(3 * a) * Math.cos(a))
  return { x: 1.35 * Math.sin(3 * a) * Math.sin(a), y: 2.8 - 2.68 * u,
    z: -1.3 + 4.5 * u, yaw: Math.atan2(dx, 4.5) }
}

export function canPump(world: World, player: Player): boolean {
  const riding = player.riding
  if (riding?.id === 'swing') {
    const swing = world.swings[riding.seat]
    const phase = Math.atan2(Math.sin(swing.angle), Math.cos(swing.angle))
    return Math.abs(phase) < .48 && world.time - swing.lastPump >= .55
  }
  if (riding?.id === 'seesaw') {
    const side = riding.seat ? 1 : -1
    // Only the descending/lowest end can kick; the high end cannot add energy.
    return side * world.seesawAngle < -.08 && Math.abs(world.seesawVelocity) < .16
      && world.time - world.seesawLastPump >= .65
  }
  return false
}

export function playerPose(world: World, player: Player): Pose {
  const pose = { x: player.x, y: 0, z: player.z, yaw: player.yaw, tilt: 0 }
  const riding = player.riding
  if (!riding) return pose
  const ride = RIDES[riding.id]
  if (riding.id === 'swing') {
    const angle = world.swings[riding.seat].angle
    return { x: ride.x + (riding.seat ? 1 : -1), y: 3.4 - Math.cos(angle) * 2.45,
      z: ride.z - Math.sin(angle) * 2.45, yaw: 0, tilt: angle }
  }
  if (riding.id === 'seesaw') {
    const side = riding.seat ? 1 : -1
    return { x: ride.x + side * Math.cos(world.seesawAngle) * 2.1,
      y: 1.2 + side * Math.sin(world.seesawAngle) * 2.1, z: ride.z,
      yaw: -side * Math.PI / 2, tilt: -side * world.seesawAngle }
  }
  if (riding.id === 'slide') {
    const age = world.time - riding.since
    if (age < SLIDE_CLIMB_TIME) return { x: ride.x, y: age / SLIDE_CLIMB_TIME * 2.8, z: ride.z - 1.6, yaw: Math.PI, tilt: 0 }
    const progress = clamp((age - SLIDE_CLIMB_TIME) / SLIDE_DURATION, 0, 1)
    const point = slidePoint(progress * .45 + progress * progress * .55)
    return { ...point, x: ride.x + point.x, z: ride.z + point.z, tilt: -.3 }
  }
  const angle = world.spinAngle + riding.seat * Math.PI / 3
  const radius = 1.45 + player.slip * .65
  return { x: ride.x + Math.sin(angle) * radius, y: .4,
    z: ride.z + Math.cos(angle) * radius, yaw: angle + Math.PI, tilt: -.16 * player.slip }
}

export function nearestRide(player: Player): RideId | null {
  let nearest: RideId | null = null, distance = 4.6
  for (const id of RIDE_IDS) {
    const ride = RIDES[id], d = Math.hypot(player.x - ride.x, player.z - ride.z)
    if (d < distance) { distance = d; nearest = id }
  }
  return nearest
}

export class PlaygroundRoom {
  world: World = createWorld()
  private inputs = new Map<string, Input & { at: number }>()
  private appearance = Math.floor(Math.random() * 1_000_000)

  join(id: string, nickname: unknown): Player | null {
    if (this.world.players[id] || Object.keys(this.world.players).length >= MAX_PLAYERS) return null
    if (typeof nickname !== 'string') return null
    const clean = nickname.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16)
    if (!clean) return null
    // A random starting point and a coprime increment give each arrival a new outfit.
    this.appearance = (this.appearance + 7919) % 1_000_000
    const index = Object.keys(this.world.players).length
    const player: Player = { id, nickname: clean, outfit: this.appearance,
      x: (index % 5 - 2) * .65, z: .5 + Math.floor(index / 5) * .65, yaw: 0,
      moving: false, riding: null, stamina: 1, slip: 0, holding: false, notice: '', pumpAt: -10, pumpResult: '' }
    this.world.players[id] = player
    return player
  }

  leave(id: string) { delete this.world.players[id]; this.inputs.delete(id) }

  command(id: string, message: unknown): void {
    const player = this.world.players[id]
    if (!player || !message || typeof message !== 'object') return
    const data = message as Record<string, unknown>
    if (data.type === 'input') {
      if (typeof data.x !== 'number' || typeof data.z !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return
      const size = Math.max(1, Math.hypot(data.x, data.z))
      this.inputs.set(id, { x: data.x / size, z: data.z / size, hold: data.hold === true, at: this.world.time })
    } else if (data.type === 'mount' && typeof data.ride === 'string' && RIDE_IDS.includes(data.ride as RideId)) {
      if (player.riding) return
      const rideId = data.ride as RideId, ride = RIDES[rideId]
      if (Math.hypot(player.x - ride.x, player.z - ride.z) > 4.6) { player.notice = '놀이기구 가까이로 이동해 주세요.'; return }
      const used = new Set(Object.values(this.world.players).filter(p => p.riding?.id === rideId).map(p => p.riding!.seat))
      const seat = Array.from({ length: ride.seats }, (_, i) => i).find(i => !used.has(i))
      if (seat === undefined) { player.notice = '모든 자리에 친구가 타고 있어요. 잠깐 기다려 주세요!'; return }
      player.riding = { id: rideId, seat, since: this.world.time }
      player.moving = false; player.slip = 0; player.stamina = 1; player.notice = ''; player.pumpResult = ''
      if (rideId === 'swing') {
        const swing = this.world.swings[seat]
        if (Math.abs(swing.velocity) < .15 && Math.abs(swing.angle) < .1) { swing.angle = .12; swing.velocity = 0 }
      }
      if (rideId === 'seesaw' && used.size === 0 && Math.abs(this.world.seesawAngle) < .1) this.world.seesawAngle = .12
    } else if (data.type === 'pump') {
      if (player.riding?.id !== 'swing' && player.riding?.id !== 'seesaw') return
      const ready = canPump(this.world, player)
      player.pumpAt = this.world.time; player.pumpResult = ready ? 'hit' : 'miss'
      if (!ready) return
      if (player.riding.id === 'swing') {
        const swing = this.world.swings[player.riding.seat]
        swing.velocity += (Math.sign(swing.velocity) || -Math.sign(Math.sin(swing.angle)) || 1) * .9
        swing.velocity = clamp(swing.velocity, -7.5, 7.5); swing.lastPump = this.world.time
      } else {
        this.world.seesawVelocity += (player.riding.seat ? 1 : -1) * .52
        this.world.seesawVelocity = clamp(this.world.seesawVelocity, -2, 2)
        this.world.seesawLastPump = this.world.time
      }
    } else if (data.type === 'dismount') this.dismount(player)
  }

  private dismount(player: Player, notice = '') {
    if (!player.riding) return
    const { id, seat } = player.riding, ride = RIDES[id]
    // Disembark outside collision volumes, with a separate spot for each seat.
    player.x = ride.x + (seat % 2 ? .8 : -.8)
    player.z = ride.z + (id === 'slide' ? 3.9 : ride.radius + 1)
    player.yaw = 0; player.riding = null; player.holding = false
    player.slip = 0; player.notice = notice
    this.inputs.delete(player.id)
  }

  tick(delta: number) {
    const dt = clamp(delta, 0, .1)
    this.world.time += dt
    const players = Object.values(this.world.players)
    for (const p of players) {
      const input = this.inputs.get(p.id)
      const active = input && this.world.time - input.at < .7
      p.holding = Boolean(active && input.hold)
      p.moving = false
      if (p.riding?.id === 'slide' && this.world.time - p.riding.since >= SLIDE_CLIMB_TIME + SLIDE_DURATION + .1) {
        this.dismount(p, '슝! 한 번 더 타 볼까요?')
      }
      if (p.riding?.id === 'spinner') {
        const force = this.world.spinSpeed ** 2 * .085
        const gripDrain = .055 + this.world.spinSpeed ** 2 * .022
        p.stamina = clamp(p.stamina + (p.holding ? -gripDrain : .3) * dt, 0, 1)
        p.slip = clamp(p.slip + (p.holding && p.stamina > .02 ? -.65 : force) * dt, 0, 1)
        if (p.slip >= 1) this.dismount(p, '빙글빙글! 잔디에 사뿐히 착지했어요. 다시 도전해 보세요.')
      }
      if (p.riding || !active) continue
      const dx = input.x * dt * 3.5, dz = input.z * dt * 3.5
      p.x = clamp(p.x + dx, -12.7, 12.7); p.z = clamp(p.z + dz, -10.7, 10.7)
      for (const ride of Object.values(RIDES)) {
        const x = p.x - ride.x, z = p.z - ride.z, d = Math.hypot(x, z)
        if (d < ride.radius) {
          p.x = ride.x + (d > .001 ? x / d : 1) * ride.radius
          p.z = ride.z + (d > .001 ? z / d : 0) * ride.radius
        }
      }
      p.moving = Math.hypot(dx, dz) > .001
      if (p.moving) { p.yaw = Math.atan2(input.x, input.z); p.notice = '' }
    }
    const spinners = players.filter(p => p.riding?.id === 'spinner').length
    if (spinners) this.world.spinSpeed = Math.min(6.5, this.world.spinSpeed + (.16 + spinners * .025) * dt)
    else this.world.spinSpeed += (.3 - this.world.spinSpeed) * dt * 1.2
    this.world.spinAngle = (this.world.spinAngle + this.world.spinSpeed * dt) % (Math.PI * 2)
    // Integrate small steps so a delayed server tick does not inject energy.
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps
    const see = players.filter(p => p.riding?.id === 'seesaw')
    const weight = see.reduce((sum, p) => sum + (p.riding!.seat ? -1 : 1), 0)
    for (let step = 0; step < steps; step++) {
      for (let seat = 0; seat < this.world.swings.length; seat++) {
        const swing = this.world.swings[seat], occupied = players.some(p => p.riding?.id === 'swing' && p.riding.seat === seat)
        swing.velocity += (-4 * Math.sin(swing.angle) - swing.velocity * (occupied ? .018 : 1.6)) * h
        swing.angle += swing.velocity * h
      }
      const damping = see.length ? .055 : 2.8
      this.world.seesawVelocity += (-2.4 * Math.sin(this.world.seesawAngle) + weight * .9 - damping * this.world.seesawVelocity) * h
      this.world.seesawAngle += this.world.seesawVelocity * h
      if (Math.abs(this.world.seesawAngle) > SEESAW_LIMIT) {
        this.world.seesawAngle = Math.sign(this.world.seesawAngle) * SEESAW_LIMIT
        this.world.seesawVelocity *= -.12
      }
    }
  }

  snapshot(): World { return structuredClone(this.world) }
}
