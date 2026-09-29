export type FoamPoint = { x: number; y: number }
export type FoamNode = FoamPoint & { vx: number; vy: number }

export function createFoamChain(root: FoamPoint, up: FoamPoint, spacing: number, count: number): FoamNode[] {
  return Array.from({ length: count }, (_, index) => ({
    x: root.x + up.x * spacing * index,
    y: root.y + up.y * spacing * index,
    vx: 0,
    vy: 0,
  }))
}

export function stepFoamChain(
  nodes: FoamNode[],
  root: FoamPoint,
  up: FoamPoint,
  spacing: number,
  deltaTime: number,
  targetOffsets: FoamPoint[] = [],
) {
  if (!nodes.length) return
  const steps = Math.max(1, Math.ceil(deltaTime / (1 / 120)))
  const step = deltaTime / steps

  for (let substep = 0; substep < steps; substep += 1) {
    nodes.forEach((node, index) => {
      const targetX = root.x + up.x * spacing * index + (targetOffsets[index]?.x ?? 0)
      const targetY = root.y + up.y * spacing * index + (targetOffsets[index]?.y ?? 0)
      // The crown has less direct attachment to the head, so it retains more
      // inertia while the dense foam near the scalp follows immediately.
      const progress = index / Math.max(1, nodes.length - 1)
      // The shared foam frame carries head motion; these springs now only
      // resolve the relative bend, avoiding a delayed, independent crown.
      const stiffness = 340 - progress * 150
      node.vx += (targetX - node.x) * stiffness * step
      node.vy += (targetY - node.y) * stiffness * step
    })

    for (let index = 0; index < nodes.length - 1; index += 1) {
      const first = nodes[index]
      const second = nodes[index + 1]
      const dx = second.x - first.x; const dy = second.y - first.y
      const distance = Math.max(.001, Math.hypot(dx, dy))
      const nx = dx / distance; const ny = dy / distance
      const relativeSpeed = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny
      const force = (distance - spacing) * 190 + relativeSpeed * 8
      const firstMobility = index === 0 ? .1 : 1
      first.vx += nx * force * step * firstMobility
      first.vy += ny * force * step * firstMobility
      second.vx -= nx * force * step
      second.vy -= ny * force * step
    }

    nodes.forEach((node, index) => {
      const progress = index / Math.max(1, nodes.length - 1)
      const drag = Math.exp(-(20 - progress * 5) * step)
      node.vx *= drag; node.vy *= drag
      node.x += node.vx * step; node.y += node.vy * step
    })

    // A foam column can bend over several links, but it must not create a
    // single sharp hinge. Limiting only extreme adjacent-segment angles keeps
    // Pinch-authored curves intact while removing the visual mid-column fold.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let index = 1; index < nodes.length - 1; index += 1) {
        const previous = nodes[index - 1]
        const node = nodes[index]
        const next = nodes[index + 1]
        const beforeX = node.x - previous.x; const beforeY = node.y - previous.y
        const afterX = next.x - node.x; const afterY = next.y - node.y
        const beforeLength = Math.max(.001, Math.hypot(beforeX, beforeY))
        const afterLength = Math.max(.001, Math.hypot(afterX, afterY))
        const alignment = (beforeX * afterX + beforeY * afterY) / (beforeLength * afterLength)
        if (alignment >= .72) continue
        const amount = Math.max(0, Math.min(1, (.72 - alignment) / 1.72)) * .46
        const midpointX = (previous.x + next.x) * .5
        const midpointY = (previous.y + next.y) * .5
        node.x += (midpointX - node.x) * amount
        node.y += (midpointY - node.y) * amount
        node.vx *= 1 - amount * .55
        node.vy *= 1 - amount * .55
      }
    }

    // A soft anchor avoids a disconnected-looking delay at the hairline while
    // preserving a small amount of frictional slip.
    nodes[0].x += (root.x - nodes[0].x) * .94
    nodes[0].y += (root.y - nodes[0].y) * .94
  }
}
