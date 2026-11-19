// Only missing browser APIs are installed. Current engines retain their native
// implementations, so successful rendering paths and artwork are unchanged.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value: function <T>(this: T[], index: number) {
      if (this == null) throw new TypeError('Array.at called on null')
      const length = this.length >>> 0, n = Math.trunc(Number(index) || 0)
      const position = n < 0 ? length + n : n
      return position < 0 || position >= length ? undefined : this[position]
    },
  })
}
if (typeof crypto !== 'undefined' && !crypto.randomUUID && crypto.getRandomValues) {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } })
}

if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  type Radius = number | DOMPointInit
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'roundRect', {
    configurable: true, writable: true,
    value: function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, input: Radius | Radius[] = 0) {
      const list = Array.isArray(input) ? input : [input]
      if (!list.length || list.length > 4) throw new RangeError('roundRect requires 1–4 radii')
      const radii = list.map(value => typeof value === 'number' ? { x: value, y: value } : { x: value.x ?? 0, y: value.y ?? 0 })
      if (radii.some(r => r.x < 0 || r.y < 0)) throw new RangeError('Negative roundRect radius')
      let corners = radii.length === 1 ? [radii[0], radii[0], radii[0], radii[0]] : radii.length === 2 ? [radii[0], radii[1], radii[0], radii[1]]
        : radii.length === 3 ? [radii[0], radii[1], radii[2], radii[1]] : radii
      if (width < 0) { x += width; width = -width; corners = [corners[1], corners[0], corners[3], corners[2]] }
      if (height < 0) { y += height; height = -height; corners = [corners[3], corners[2], corners[1], corners[0]] }
      const [a, b, c, d] = corners
      const factor = Math.min(1, width / (a.x + b.x || 1), width / (d.x + c.x || 1), height / (a.y + d.y || 1), height / (b.y + c.y || 1))
      const r = corners.map(point => ({ x: point.x * factor, y: point.y * factor }))
      this.moveTo(x + r[0].x, y); this.lineTo(x + width - r[1].x, y)
      this.ellipse(x + width - r[1].x, y + r[1].y, r[1].x, r[1].y, 0, -Math.PI / 2, 0)
      this.lineTo(x + width, y + height - r[2].y)
      this.ellipse(x + width - r[2].x, y + height - r[2].y, r[2].x, r[2].y, 0, 0, Math.PI / 2)
      this.lineTo(x + r[3].x, y + height)
      this.ellipse(x + r[3].x, y + height - r[3].y, r[3].x, r[3].y, 0, Math.PI / 2, Math.PI)
      this.lineTo(x, y + r[0].y)
      this.ellipse(x + r[0].x, y + r[0].y, r[0].x, r[0].y, 0, Math.PI, Math.PI * 1.5); this.closePath()
    },
  })
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  const observers = new Set<FallbackResizeObserver>()
  let pending = false
  const schedule = () => {
    if (pending || document.hidden || !observers.size) return
    pending = true
    requestAnimationFrame(() => { pending = false; for (const observer of observers) observer.check() })
  }
  class FallbackResizeObserver implements ResizeObserver {
    private targets = new Map<Element, { width: number; height: number }>()
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) { this.targets.set(target, { width: -1, height: -1 }); observers.add(this); schedule() }
    unobserve(target: Element) { this.targets.delete(target); if (!this.targets.size) observers.delete(this) }
    disconnect() { this.targets.clear(); observers.delete(this) }
    check() {
      const entries: ResizeObserverEntry[] = []
      for (const [target, previous] of this.targets) {
        const rect = target.getBoundingClientRect()
        if (rect.width === previous.width && rect.height === previous.height) continue
        previous.width = rect.width; previous.height = rect.height
        const box = [{ inlineSize: rect.width, blockSize: rect.height }]
        entries.push({ target, contentRect: rect, borderBoxSize: box, contentBoxSize: box, devicePixelContentBoxSize: box })
      }
      if (entries.length) this.callback(entries, this)
    }
  }
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: FallbackResizeObserver })
  window.addEventListener('resize', schedule, { passive: true }); window.addEventListener('pageshow', schedule)
  document.addEventListener('visibilitychange', schedule)
  const watch = () => {
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] })
    void document.fonts?.ready.then(schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true }); else watch()
}
export {}
