import * as THREE from 'three'

/** Exact nearest-point queries for immutable river/path samples. No grid rounding. */
export function indexForestPoints(points: readonly THREE.Vector3[]) {
  type Node = { point: THREE.Vector3; axis: number; left: Node | null; right: Node | null }
  function build(input: THREE.Vector3[], depth: number): Node | null {
    if (!input.length) return null
    const axis = depth % 3; input.sort((a, b) => a.getComponent(axis) - b.getComponent(axis))
    const middle = input.length >> 1
    return { point: input[middle], axis, left: build(input.slice(0, middle), depth + 1), right: build(input.slice(middle + 1), depth + 1) }
  }
  const root = build([...points], 0)
  function search(node: Node | null, p: THREE.Vector3, best: number): number {
    if (!node) return best
    best = Math.min(best, p.distanceToSquared(node.point))
    const delta = p.getComponent(node.axis) - node.point.getComponent(node.axis)
    best = search(delta < 0 ? node.left : node.right, p, best)
    if (delta * delta < best) best = search(delta < 0 ? node.right : node.left, p, best)
    return best
  }
  return { distance: (point: THREE.Vector3) => Math.sqrt(search(root, point, 100)) }
}

/** Keep every original triangle/UV; only narrow the ray test to intersected boxes. */
export function accelerateForestGround(mesh: THREE.Mesh) {
  const geometry = mesh.geometry, index = geometry.index, positions = geometry.getAttribute('position')
  if (!index || Array.isArray(mesh.material) || geometry.groups.length) return
  type Node = { bounds: THREE.Box3; left?: Node; right?: Node; proxy?: THREE.Mesh; faces?: number[] }
  const triangleCount = index.count / 3, centers = new Float64Array(triangleCount * 3)
  for (let face = 0; face < triangleCount; face++) for (let axis = 0; axis < 3; axis++) {
    centers[face * 3 + axis] = (positions.getComponent(index.getX(face * 3), axis) + positions.getComponent(index.getX(face * 3 + 1), axis) + positions.getComponent(index.getX(face * 3 + 2), axis)) / 3
  }
  const scratch = new THREE.Vector3(), owned: THREE.BufferGeometry[] = []
  function build(faces: number[]): Node {
    const bounds = new THREE.Box3()
    for (const face of faces) for (let i = 0; i < 3; i++) bounds.expandByPoint(scratch.fromBufferAttribute(positions, index!.getX(face * 3 + i)))
    if (faces.length <= 384) {
      const part = new THREE.BufferGeometry()
      // Attributes stay shared so UVs and normals are exactly the source mesh's.
      for (const [name, attribute] of Object.entries(geometry.attributes)) part.setAttribute(name, attribute)
      part.setIndex(faces.flatMap(face => [index!.getX(face * 3), index!.getX(face * 3 + 1), index!.getX(face * 3 + 2)]))
      part.boundingBox = bounds; part.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere()); owned.push(part)
      return { bounds, proxy: new THREE.Mesh(part, mesh.material), faces }
    }
    const size = bounds.getSize(scratch), axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2
    faces.sort((a, b) => centers[a * 3 + axis] - centers[b * 3 + axis])
    const middle = faces.length >> 1
    return { bounds, left: build(faces.slice(0, middle)), right: build(faces.slice(middle)) }
  }
  const root = build(Array.from({ length: triangleCount }, (_, i) => i))
  const inverse = new THREE.Matrix4(), localRay = new THREE.Ray()
  const hits: THREE.Intersection[] = []
  function intersect(node: Node, raycaster: THREE.Raycaster, output: THREE.Intersection[]) {
    if (!localRay.intersectsBox(node.bounds)) return
    if (node.proxy) {
      node.proxy.matrixWorld.copy(mesh.matrixWorld); node.proxy.material = mesh.material
      hits.length = 0; THREE.Mesh.prototype.raycast.call(node.proxy, raycaster, hits)
      for (const hit of hits) { hit.object = mesh; hit.faceIndex = node.faces![hit.faceIndex!]; output.push(hit) }
    } else { intersect(node.left!, raycaster, output); intersect(node.right!, raycaster, output) }
  }
  mesh.raycast = (raycaster, output) => {
    inverse.copy(mesh.matrixWorld).invert(); localRay.copy(raycaster.ray).applyMatrix4(inverse)
    intersect(root, raycaster, output)
  }
  geometry.addEventListener('dispose', () => owned.forEach(part => part.dispose()))
}

export function setForestText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value
}
