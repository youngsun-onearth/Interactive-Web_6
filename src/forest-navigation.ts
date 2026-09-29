import * as THREE from 'three'

// Shared exact navigation for examples 14/15. Cache fixed terrain edges, while
// checking moving residents afresh on every route request.
export function createForestNavigation(sample: (p: THREE.Vector3) => { waterDistance: number }, trees: THREE.Vector3[]) {
  const rows = 48, columns = 96
  const points: THREE.Vector3[] = [], costs: number[] = []
  for (let row = 0; row <= rows; row++) for (let column = 0; column < columns; column++) {
    const latitude = -Math.PI / 2 + row / rows * Math.PI, longitude = column / columns * Math.PI * 2
    const p = new THREE.Vector3(Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude))
    points.push(p); costs.push(trees.some(t => t.distanceToSquared(p) < .0049) ? Infinity : sample(p).waterDistance < .045 ? 14 : 1)
  }
  type Edge = { next: number; midpoint: THREE.Vector3; cost: number }
  const edges = new Map<number, Edge[]>()
  function neighbors(current: number) {
    const cached = edges.get(current); if (cached) return cached
    const result: Edge[] = [], row = Math.floor(current / columns), column = current % columns
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || row + dy < 0 || row + dy > rows) continue
      const next = (row + dy) * columns + (column + dx + columns) % columns
      if (!Number.isFinite(costs[next])) continue
      const midpoint = points[current].clone().add(points[next]).normalize()
      if (trees.some(t => t.distanceToSquared(midpoint) < .0049)) continue
      result.push({ next, midpoint, cost: points[current].distanceTo(points[next]) * (costs[current] + costs[next]) * .5 })
    }
    edges.set(current, result); return result
  }
  const blocked = new Uint8Array(points.length), closed = new Uint8Array(points.length)
  const distance = new Float64Array(points.length), score = new Float64Array(points.length)
  const previous = new Int32Array(points.length), order = new Int32Array(points.length)
  const nearest = (p: THREE.Vector3) => {
    let best = -1, distance = Infinity
    for (let i = 0; i < points.length; i++) if (Number.isFinite(costs[i]) && !blocked[i]) {
      const d = p.distanceToSquared(points[i]); if (d < distance) { best = i; distance = d }
    }
    return best
  }
  type Entry = { node: number; score: number; order: number }
  const heap: Entry[] = []
  const before = (a: Entry, b: Entry) => a.score < b.score || (a.score === b.score && a.order < b.order)
  function push(entry: Entry) {
    let i = heap.length; heap.push(entry)
    while (i) { const parent = (i - 1) >> 1; if (!before(entry, heap[parent])) break; heap[i] = heap[parent]; i = parent }
    heap[i] = entry
  }
  function pop() {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      let i = 0
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++
        if (!before(heap[child], last)) break
        heap[i] = heap[child]; i = child
      }
      heap[i] = last
    }
    return first
  }
  return {
    route(start: THREE.Vector3, end: THREE.Vector3, residents: { position: THREE.Vector3; radius: number }[] = []): THREE.Vector3[] {
      const occupied = (p: THREE.Vector3) => residents.some(r => p.distanceToSquared(r.position) < r.radius * r.radius)
      for (let i = 0; i < points.length; i++) blocked[i] = occupied(points[i]) ? 1 : 0
      const source = nearest(start), destination = nearest(end)
      if (source < 0 || destination < 0) return []
      distance.fill(Infinity); score.fill(Infinity); previous.fill(-1); order.fill(-1); closed.fill(0); heap.length = 0
      let sequence = 0
      distance[source] = 0; score[source] = points[source].distanceTo(end); order[source] = sequence++
      push({ node: source, score: score[source], order: order[source] })
      while (heap.length) {
        const entry = pop(), current = entry.node
        if (closed[current] || entry.score !== score[current]) continue
        if (current === destination) {
          const result = [end.clone()]; let i = current
          while (i !== -1) { result.push(points[i].clone()); i = previous[i] }
          return result.reverse()
        }
        closed[current] = 1
        for (const { next, midpoint, cost } of neighbors(current)) {
          if (closed[next] || blocked[next] || occupied(midpoint)) continue
          const candidate = distance[current] + cost
          if (candidate >= distance[next]) continue
          distance[next] = candidate; score[next] = candidate + points[next].distanceTo(end); previous[next] = current
          if (order[next] < 0) order[next] = sequence++
          push({ node: next, score: score[next], order: order[next] })
        }
      }
      return []
    },
  }
}
