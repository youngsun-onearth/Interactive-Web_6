type Spark = {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  hue: number
  size: number
  drag: number
  gravity: number
  shimmer: number
}

type Point = { x: number; y: number }
type Charge = Point & { startedAt: number; hue: number; path: Point[] }
type ScheduledBurst = Point & { power: number; hue: number; at: number }
type BurstShape = 'bloom' | 'ring' | 'star' | 'heart' | 'willow'

const SHAPES: BurstShape[] = ['bloom', 'ring', 'star', 'heart', 'willow']
const random = (min: number, max: number) => min + Math.random() * (max - min)
const chargePower = (duration: number) => Math.min(1, Math.max(0, duration) / 2400)

export function createFireworks(stage: HTMLElement, panel: HTMLElement) {
  const canvas = panel.querySelector<HTMLCanvasElement>('.fireworks-canvas')!
  const clouds = panel.querySelector<HTMLCanvasElement>('.cloud-title__canvas')!
  const ctx = canvas.getContext('2d')!
  const cloudCtx = clouds.getContext('2d')!
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const charges = new Map<number, Charge>()
  let sparks: Spark[] = []
  let pendingBursts: ScheduledBurst[] = []
  let active = false
  let frame = 0
  let width = 0
  let height = 0

  // Sample the letter silhouettes, then build them from soft, overlapping cloud puffs.
  function drawCloudTitle() {
    const bounds = clouds.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const scale = Math.min(devicePixelRatio || 1, 2)
    clouds.width = Math.round(bounds.width * scale)
    clouds.height = Math.round(bounds.height * scale)
    cloudCtx.setTransform(scale, 0, 0, scale, 0, 0)
    const mask = document.createElement('canvas')
    mask.width = Math.ceil(bounds.width)
    mask.height = Math.ceil(bounds.height)
    const maskCtx = mask.getContext('2d', { willReadFrequently: true })!
    const fontSize = Math.min(138, bounds.width / 5.65, bounds.height / 2.7)
    maskCtx.font = `900 ${fontSize}px "Black Han Sans", "Apple SD Gothic Neo", sans-serif`
    maskCtx.textAlign = 'center'
    maskCtx.textBaseline = 'middle'
    const lines = [{ text: '바이브코딩', y: bounds.height * 0.30 }, { text: '워크숍', y: bounds.height * 0.73 }]
    for (const line of lines) maskCtx.fillText(line.text, bounds.width / 2, line.y)
    const pixels = maskCtx.getImageData(0, 0, mask.width, mask.height).data
    // A stable noise function keeps the clouds from changing on each resize.
    const noise = (x: number, y: number) => {
      const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      return value - Math.floor(value)
    }
    const step = Math.max(2.5, fontSize / 30)
    for (let y = 0; y < mask.height; y += step) {
      for (let x = 0; x < mask.width; x += step) {
        if (pixels[(Math.floor(y) * mask.width + Math.floor(x)) * 4 + 3] < 150) continue
        const n = noise(x, y)
        const radius = step * (1.2 + n * 1.8)
        const px = x + (n - 0.5) * step
        const py = y + (noise(y, x) - 0.5) * step
        const puff = cloudCtx.createRadialGradient(px, py - radius * 0.2, 0, px, py, radius)
        puff.addColorStop(0, `rgba(224, 234, 248, ${0.10 + n * 0.13})`)
        puff.addColorStop(0.5, 'rgba(180, 201, 227, 0.075)')
        puff.addColorStop(1, 'rgba(155, 183, 218, 0)')
        cloudCtx.fillStyle = puff
        cloudCtx.fillRect(px - radius, py - radius, radius * 2, radius * 2)
      }
    }
  }

  function resize() {
    width = window.innerWidth
    height = window.innerHeight
    const scale = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawCloudTitle()
  }

  function burst(charge: ScheduledBurst, now: number) {
    const power = charge.power
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)]!
    const radius = Math.min(width, height) * (0.12 + power * 0.32)
    const count = Math.round((100 + power * 150) * (reducedMotion.matches ? 0.45 : 1))
    const rotation = shape === 'heart' ? 0 : random(0, Math.PI * 2)
    const multicolor = Math.random() < 0.35
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      let dx = Math.cos(angle + rotation)
      let dy = Math.sin(angle + rotation)
      let reach = 1
      if (shape === 'heart') {
        dx = Math.sin(angle) ** 3
        dy = -(13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) / 16
        reach = random(0.88, 1)
      } else if (shape === 'star') {
        reach = 0.46 + 0.54 * ((Math.cos(5 * angle) + 1) / 2) ** 2
      } else if (shape === 'bloom' || shape === 'willow') {
        reach = Math.sqrt(Math.random())
      } else {
        dy *= 0.72
        reach = random(0.94, 1.04)
      }
      const speed = radius * reach * 1.65
      sparks.push({
        x: charge.x, y: charge.y, vx: dx * speed, vy: dy * speed,
        born: now, life: random(1300, 2100) + power * 500,
        hue: (charge.hue + (multicolor ? (i % 3) * 65 : random(-14, 14)) + 360) % 360,
        size: random(1, 2.1) + power * 0.7,
        drag: shape === 'willow' ? 1.05 : 1.65,
        gravity: shape === 'willow' ? 75 : 34,
        shimmer: random(0, Math.PI * 2),
      })
    }
    // Keep rapid taps and multiple fingers within a fixed rendering budget.
    if (sparks.length > 2200) sparks.splice(0, sparks.length - 2200)
  }

  function recordPoint(charge: Charge, x: number, y: number, final = false) {
    charge.x = Math.max(0, Math.min(width, x))
    charge.y = Math.max(0, Math.min(height, y))
    const previous = charge.path[charge.path.length - 1]!
    if (Math.hypot(charge.x - previous.x, charge.y - previous.y) < (final ? 0.5 : 8)) return
    charge.path.push({ x: charge.x, y: charge.y })
    // Retain the entire gesture, including its endpoints, during very long drags.
    if (charge.path.length > 512) charge.path = charge.path.filter((_, index) => index % 2 === 0 || index === charge.path.length - 1)
  }

  function releaseCharge(charge: Charge, now: number) {
    const power = chargePower(now - charge.startedAt)
    let length = 0
    for (let i = 1; i < charge.path.length; i++) {
      const a = charge.path[i - 1]!, b = charge.path[i]!
      length += Math.hypot(b.x - a.x, b.y - a.y)
    }
    const points: Point[] = [charge.path[0]!]
    if (length > 12) {
      // Sample by distance so both fast flicks and slow curves form a steady chain.
      const spacing = Math.max(56, Math.min(width, height) * 0.1, length / 31)
      let travelled = 0
      let next = spacing
      for (let i = 1; i < charge.path.length; i++) {
        const a = charge.path[i - 1]!, b = charge.path[i]!
        const distance = Math.hypot(b.x - a.x, b.y - a.y)
        while (next < travelled + distance) {
          const t = (next - travelled) / distance
          points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
          next += spacing
        }
        travelled += distance
      }
      const end = charge.path[charge.path.length - 1]!
      const previous = points[points.length - 1]!
      if (Math.hypot(end.x - previous.x, end.y - previous.y) < spacing * 0.3 && points.length > 1) points[points.length - 1] = end
      else points.push(end)
    }
    points.forEach((point, index) => pendingBursts.push({
      ...point, power, hue: index === 0 ? charge.hue : random(0, 360), at: now + index * 70,
    }))
    if (pendingBursts.length > 256) pendingBursts.splice(0, pendingBursts.length - 256)
    requestFrame()
  }

  function draw(now: number) {
    frame = 0
    ctx.clearRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'lighter'
    pendingBursts = pendingBursts.filter(scheduled => {
      if (scheduled.at > now) return true
      burst(scheduled, now)
      return false
    })
    sparks = sparks.filter(spark => now - spark.born < spark.life)
    for (const spark of sparks) {
      const age = now - spark.born
      const t = age / 1000
      const tail = Math.max(0, t - (reducedMotion.matches ? 0.018 : 0.055))
      const travel = (1 - Math.exp(-spark.drag * t)) / spark.drag
      const tailTravel = (1 - Math.exp(-spark.drag * tail)) / spark.drag
      const x = spark.x + spark.vx * travel
      const y = spark.y + spark.vy * travel + spark.gravity * t * t
      const alpha = Math.min(1, (1 - age / spark.life) * 2) * (0.76 + Math.sin(t * 24 + spark.shimmer) * 0.24)
      ctx.strokeStyle = `hsla(${spark.hue}, 100%, 72%, ${alpha})`
      ctx.lineWidth = spark.size * (1 - age / spark.life * 0.65)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(spark.x + spark.vx * tailTravel, spark.y + spark.vy * tailTravel + spark.gravity * tail * tail)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.fillStyle = `hsla(${spark.hue}, 100%, 85%, ${alpha * 0.16})`
      ctx.beginPath()
      ctx.arc(x, y, spark.size * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const charge of charges.values()) {
      if (charge.path.length > 1) {
        ctx.strokeStyle = `hsla(${charge.hue}, 90%, 78%, 0.24)`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        charge.path.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y)
          else ctx.lineTo(point.x, point.y)
        })
        ctx.lineTo(charge.x, charge.y)
        ctx.stroke()
      }
      const power = chargePower(now - charge.startedAt)
      const radius = 10 + power * 34
      const glow = ctx.createRadialGradient(charge.x, charge.y, 0, charge.x, charge.y, radius * 2.8)
      glow.addColorStop(0, `hsla(${charge.hue}, 100%, 90%, 0.85)`)
      glow.addColorStop(0.14, `hsla(${charge.hue}, 100%, 70%, 0.45)`)
      glow.addColorStop(1, `hsla(${charge.hue}, 100%, 60%, 0)`)
      ctx.fillStyle = glow
      ctx.fillRect(charge.x - radius * 2.8, charge.y - radius * 2.8, radius * 5.6, radius * 5.6)
      ctx.strokeStyle = `hsla(${charge.hue}, 90%, 82%, 0.45)`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(charge.x, charge.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.08, power))
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
    if (sparks.length || charges.size || pendingBursts.length) requestFrame()
  }

  function requestFrame() {
    if (!frame && active && !document.hidden) frame = requestAnimationFrame(draw)
  }

  function clear() {
    cancelAnimationFrame(frame)
    frame = 0
    sparks = []
    pendingBursts = []
    const pointerIds = [...charges.keys()]
    charges.clear()
    for (const id of pointerIds) if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id)
    ctx.clearRect(0, 0, width, height)
  }

  stage.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0 || charges.size >= 8) return
    if (event.target instanceof Element && event.target.closest('a, button, input, textarea, select, [role="button"], .example-controls')) return
    event.preventDefault()
    charges.set(event.pointerId, {
      x: event.clientX, y: event.clientY, startedAt: performance.now(), hue: random(0, 360),
      path: [{ x: event.clientX, y: event.clientY }],
    })
    // Capture keeps the gesture on the stage, but tracking must also work when
    // the browser releases capture or cannot acquire it.
    try { stage.setPointerCapture(event.pointerId) } catch { /* Window listeners keep tracking. */ }
    requestFrame()
  })
  window.addEventListener('pointermove', event => {
    const charge = charges.get(event.pointerId)
    if (!charge) return
    event.preventDefault()
    const samples = event.getCoalescedEvents?.() ?? []
    for (const sample of samples) recordPoint(charge, sample.clientX, sample.clientY)
    recordPoint(charge, event.clientX, event.clientY)
  }, { capture: true, passive: false })
  window.addEventListener('pointerup', event => {
    const charge = charges.get(event.pointerId)
    if (!charge) return
    recordPoint(charge, event.clientX, event.clientY, true)
    charges.delete(event.pointerId)
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
    if (active) releaseCharge(charge, performance.now())
  }, { capture: true })
  const cancelCharge = (event: PointerEvent) => { charges.delete(event.pointerId) }
  window.addEventListener('pointercancel', cancelCharge, { capture: true })
  // lostpointercapture is not a cancelled gesture. Retain the path until
  // pointerup, even if release happens over a control that stops bubbling.
  stage.addEventListener('contextmenu', event => { if (active && charges.size) event.preventDefault() })
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear() })
  window.addEventListener('resize', resize)
  new ResizeObserver(drawCloudTitle).observe(clouds)
  void document.fonts.ready.then(drawCloudTitle)

  return {
    setActive(value: boolean) {
      if (active === value) return
      active = value
      if (active) resize()
      else clear()
    },
  }
}
