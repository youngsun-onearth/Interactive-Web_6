import './bubble-wrap.css'
import { createBubbleWrapAudio } from './bubble-wrap-audio'

type Point = { x: number; y: number }
type Bubble = {
  button: HTMLButtonElement
  dome: HTMLElement
  crease: HTMLElement
  poppedAt: number | null
  duration: number
  animations: Animation[]
}

export function createBubbleWrap(panel: HTMLElement) {
  const audio = createBubbleWrapAudio()
  const pointers = new Map<number, Point>()
  let bubbles: Bubble[] = []
  let active = false
  let columns = 0
  let rows = 0
  let cellSize = 0

  function ready(bubble: Bubble) {
    bubble.poppedAt = null
    bubble.button.dataset.state = 'ready'
    bubble.button.setAttribute('aria-disabled', 'false')
    for (const animation of bubble.animations) animation.cancel()
    bubble.animations = []
  }

  function pop(bubble: Bubble) {
    if (!active || document.hidden || bubble.poppedAt !== null) return
    bubble.poppedAt = performance.now()
    bubble.button.dataset.state = 'popped'
    bubble.button.setAttribute('aria-disabled', 'true')
    audio.play()
    const duration = bubble.duration
    const easing = 'cubic-bezier(0.35, 0, 0.35, 1)'
    const dome = bubble.dome.animate([
      { transform: 'scale(1)', opacity: 1, offset: 0 },
      { transform: 'scale(0.94, 0.86)', opacity: 0.05, offset: 0.009 },
      { transform: 'scale(0.94, 0.86)', opacity: 0.05, offset: 0.22, easing },
      { transform: 'scale(1)', opacity: 1, offset: 1 },
    ], { duration, fill: 'both' })
    const crease = bubble.crease.animate([
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.009 },
      { opacity: 1, offset: 0.22, easing },
      { opacity: 0, offset: 1 },
    ], { duration, fill: 'both' })
    bubble.animations = [dome, crease]
    dome.onfinish = () => ready(bubble)
  }

  function clearPointers() {
    const ids = [...pointers.keys()]
    pointers.clear()
    for (const id of ids) if (panel.hasPointerCapture(id)) panel.releasePointerCapture(id)
  }

  function layout() {
    if (!active) return
    const bounds = panel.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const ideal = Math.max(bounds.width < 600 ? 64 : 78, Math.sqrt(bounds.width * bounds.height / 550))
    const nextColumns = Math.max(4, Math.floor(bounds.width / ideal))
    cellSize = bounds.width / nextColumns
    const nextRows = Math.ceil(bounds.height / cellSize)
    panel.style.gridTemplateColumns = `repeat(${nextColumns}, minmax(0, 1fr))`
    panel.style.gridAutoRows = `${cellSize}px`
    if (columns === nextColumns && rows === nextRows) return
    clearPointers()
    const previous = new Map(bubbles.map((bubble, i) => [`${Math.floor(i / columns)}:${i % columns}`, bubble]))
    columns = nextColumns; rows = nextRows
    bubbles = []
    const fragment = document.createDocumentFragment()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const key = `${row}:${col}`
        let bubble = previous.get(key)
        if (bubble) previous.delete(key)
        else {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'bubble-wrap__bubble'
          button.dataset.state = 'ready'
          button.setAttribute('aria-label', '뽁뽁이 터뜨리기')
          button.setAttribute('aria-disabled', 'false')
          button.style.setProperty('--bubble-tilt', `${((row * 17 + col * 13) % 19) - 9}deg`)
          button.innerHTML = '<span class="bubble-wrap__crease" aria-hidden="true"></span><span class="bubble-wrap__dome" aria-hidden="true"></span>'
          bubble = {
            button, dome: button.querySelector<HTMLElement>('.bubble-wrap__dome')!,
            crease: button.querySelector<HTMLElement>('.bubble-wrap__crease')!,
            poppedAt: null, duration: 6600 + ((row * 31 + col * 19) % 11) * 100, animations: [],
          }
        }
        bubble.button.dataset.index = String(bubbles.length)
        bubble.button.tabIndex = bubbles.length === 0 ? 0 : -1
        bubbles.push(bubble)
        fragment.append(bubble.button)
      }
    }
    for (const bubble of previous.values()) ready(bubble)
    panel.replaceChildren(fragment)
  }

  function localPoint(event: PointerEvent): Point {
    const bounds = panel.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  // Test the complete swept segment against the circular pockets, so fast swipes
  // neither miss bubbles between input events nor pop pockets beside the path.
  function popAlong(from: Point, to: Point) {
    const dx = to.x - from.x, dy = to.y - from.y
    const lengthSquared = dx * dx + dy * dy
    const hits: { bubble: Bubble; t: number }[] = []
    const firstCol = Math.max(0, Math.floor(Math.min(from.x, to.x) / cellSize))
    const lastCol = Math.min(columns - 1, Math.floor(Math.max(from.x, to.x) / cellSize))
    const firstRow = Math.max(0, Math.floor(Math.min(from.y, to.y) / cellSize))
    const lastRow = Math.min(rows - 1, Math.floor(Math.max(from.y, to.y) / cellSize))
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        const bubble = bubbles[row * columns + col]!
        if (bubble.poppedAt !== null) continue
        const x = (col + 0.5) * cellSize, y = (row + 0.5) * cellSize
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared)) : 0
        if (Math.hypot(x - from.x - dx * t, y - from.y - dy * t) <= cellSize * 0.41) hits.push({ bubble, t })
      }
    }
    hits.sort((a, b) => a.t - b.t).forEach(({ bubble }) => pop(bubble))
  }

  panel.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0 || pointers.size >= 8) return
    event.preventDefault()
    audio.unlock()
    const point = localPoint(event)
    pointers.set(event.pointerId, point)
    panel.setPointerCapture(event.pointerId)
    popAlong(point, point)
  })
  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const point = localPoint(event)
    popAlong(previous, point)
    pointers.set(event.pointerId, point)
  }
  panel.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return
    event.preventDefault()
    for (const sample of event.getCoalescedEvents?.() ?? []) move(sample)
    move(event)
  })
  panel.addEventListener('pointerup', event => {
    if (!pointers.has(event.pointerId)) return
    audio.unlock()
    move(event)
    pointers.delete(event.pointerId)
    if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId)
  })
  const cancelPointer = (event: PointerEvent) => { pointers.delete(event.pointerId) }
  panel.addEventListener('pointercancel', cancelPointer)
  panel.addEventListener('lostpointercapture', cancelPointer)
  panel.addEventListener('contextmenu', event => event.preventDefault())
  panel.addEventListener('click', event => {
    // Pointer input already pops on contact. Native keyboard/assistive clicks
    // have detail 0 and should activate the same button without visible labels.
    if (event.detail !== 0 || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('.bubble-wrap__bubble')
    if (!button) return
    audio.unlock()
    pop(bubbles[Number(button.dataset.index)]!)
  })
  panel.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLButtonElement)) return
    const index = Number(event.target.dataset.index)
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
    if (!(event.key in offsets)) return
    event.preventDefault()
    const next = bubbles[Math.max(0, Math.min(bubbles.length - 1, index + offsets[event.key]!))]!
    event.target.tabIndex = -1
    next.button.tabIndex = 0
    next.button.focus({ preventScroll: true })
  })

  function syncAnimations() {
    const running = active && !document.hidden
    for (const bubble of bubbles) {
      if (bubble.poppedAt === null) continue
      if (!running) bubble.animations.forEach(animation => animation.pause())
      else {
        const elapsed = performance.now() - bubble.poppedAt
        if (elapsed >= bubble.duration) ready(bubble)
        else bubble.animations.forEach(animation => { animation.currentTime = elapsed; animation.play() })
      }
    }
    if (!running) { clearPointers(); audio.stop() }
  }
  window.addEventListener('resize', layout)
  window.visualViewport?.addEventListener('resize', layout)
  new ResizeObserver(layout).observe(panel)
  window.addEventListener('blur', () => { clearPointers(); audio.stop() })
  document.addEventListener('visibilitychange', syncAnimations)

  return {
    setActive(value: boolean) {
      if (active === value) return
      active = value
      if (active) layout()
      syncAnimations()
    },
  }
}
