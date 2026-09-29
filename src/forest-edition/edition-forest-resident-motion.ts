import * as THREE from 'three'

export const RESIDENT_SPACING = .13
export function tangentAt(normal: THREE.Vector3) {
  return new THREE.Vector3().crossVectors(Math.abs(normal.y) > .95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), normal).normalize()
}
export function meetingSlots(center: THREE.Vector3, count: number, allowed: (p: THREE.Vector3) => boolean) {
  const right = tangentAt(center); const forward = new THREE.Vector3().crossVectors(center, right)
  const slots: THREE.Vector3[] = []
  for (let ring = 1; slots.length < count && ring < 18; ring++) {
    const radius = ring * RESIDENT_SPACING * 1.2; const capacity = Math.max(6, Math.floor(2 * Math.PI * radius / (RESIDENT_SPACING * 1.2)))
    for (let j = 0; j < capacity && slots.length < count; j++) {
      const angle = 2 * Math.PI * j / capacity + ring * .31
      const p = center.clone().multiplyScalar(Math.cos(radius)).addScaledVector(right, Math.sin(radius) * Math.cos(angle)).addScaledVector(forward, Math.sin(radius) * Math.sin(angle)).normalize()
      if (allowed(p) && slots.every(other => other.distanceTo(p) >= RESIDENT_SPACING)) slots.push(p)
    }
  }
  return slots
}

// A spherical navigation graph favors dry ground and avoids tree trunks. Stream
// crossings remain possible where the globe's river network separates the land.
export function createForestRoutes(terrain: (p: THREE.Vector3) => { waterDistance: number }, trees: THREE.Vector3[]) {
  const nodes: THREE.Vector3[] = []; const costs: number[] = []; const links: number[][] = []
  for (let i = 0; i < 1900; i++) {
    const y = 1 - (i + .5) / 1900 * 2; const angle = i * 2.3999632297
    const p = new THREE.Vector3(Math.cos(angle) * Math.sqrt(1 - y * y), y, Math.sin(angle) * Math.sqrt(1 - y * y))
    if (trees.some(t => t.distanceToSquared(p) < .006)) continue
    nodes.push(p); costs.push(terrain(p).waterDistance < .057 ? 18 : 1)
  }
  for (let i = 0; i < nodes.length; i++) {
    links.push(nodes.map((p, j) => ({ j, d: p.distanceToSquared(nodes[i]) })).filter(v => v.j !== i && v.d < .035)
      .sort((a, b) => a.d - b.d).slice(0, 10).filter(v => {
        const a = nodes[i]; const b = nodes[v.j]
        return [.25, .5, .75].every(t => !trees.some(tree => tree.distanceToSquared(a.clone().lerp(b, t).normalize()) < .0049))
      }).map(v => v.j))
  }
  function nearest(p: THREE.Vector3) {
    let best = 0; let distance = Infinity
    nodes.forEach((n, i) => { const d = n.distanceToSquared(p); if (d < distance) { distance = d; best = i } }); return best
  }
  return (from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] => {
    const start = nearest(from); const end = nearest(to); const open = new Set([start]); const previous = new Int32Array(nodes.length).fill(-1)
    const distance = new Float64Array(nodes.length).fill(Infinity); distance[start] = 0
    while (open.size) {
      let current = start; let best = Infinity
      for (const i of open) { const score = distance[i] + nodes[i].distanceTo(nodes[end]); if (score < best) { best = score; current = i } }
      if (current === end) {
        const path = [to.clone()]; let cursor = end
        while (cursor !== start) { path.unshift(nodes[cursor].clone()); cursor = previous[cursor] }
        path.unshift(nodes[start].clone()); return path
      }
      open.delete(current)
      for (const next of links[current]) {
        const cost = distance[current] + nodes[current].distanceTo(nodes[next]) * (costs[current] + costs[next]) * .5
        if (cost < distance[next]) { distance[next] = cost; previous[next] = current; open.add(next) }
      }
    }
    return []
  }
}

// A smooth radial brush moves a neighborhood of UVs, never the mesh vertices.
export function brushWeight(distance: number, radius: number) {
  const t = Math.max(0, 1 - distance / radius)
  return t * t * (3 - 2 * t)
}
