import * as THREE from 'three'

export const FOREST_UP = new THREE.Vector3(0, 1, 0)
export function forestTangent(normal: THREE.Vector3) {
  return new THREE.Vector3().crossVectors(Math.abs(normal.y) > .95 ? new THREE.Vector3(1, 0, 0) : FOREST_UP, normal).normalize()
}
export function forestOrientation(normal: THREE.Vector3, forward: THREE.Vector3) {
  const heading = forward.clone().addScaledVector(normal, -forward.dot(normal)).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(normal, heading).normalize(), normal, heading))
}
export function meetingSlots(center: THREE.Vector3, count: number, free: (p: THREE.Vector3) => boolean, spacing = .145) {
  const slots: THREE.Vector3[] = []
  const across = forestTangent(center); const vertical = new THREE.Vector3().crossVectors(center, across)
  for (let ring = 1; ring <= 8 && slots.length < count; ring++) {
    const radius = ring * spacing; const points = Math.max(5, Math.floor(Math.PI * 2 * Math.sin(radius) / spacing))
    for (let i = 0; i < points && slots.length < count; i++) {
      const angle = i * Math.PI * 2 / points + ring * .37
      const p = center.clone().multiplyScalar(Math.cos(radius)).addScaledVector(across, Math.sin(radius) * Math.cos(angle)).addScaledVector(vertical, Math.sin(radius) * Math.sin(angle)).normalize()
      if (free(p) && slots.every(other => other.distanceTo(p) >= spacing * .97)) slots.push(p)
    }
  }
  return slots
}

export { createForestNavigation } from './forest-navigation.ts'

// Compact, smooth falloff: the displacement and its slope vanish at the edge.
// Only UVs change; the character's vertices and silhouette remain untouched.
export function warpSurfaceUV(positions: ArrayLike<number>, normals: ArrayLike<number>, uv: Float32Array,
  center: THREE.Vector3, surfaceNormal: THREE.Vector3, delta: THREE.Vector2, radius: number) {
  for (let i = 0; i < uv.length / 2; i++) {
    const p = i * 3; const d = Math.hypot(positions[p] - center.x, positions[p + 1] - center.y, positions[p + 2] - center.z) / radius
    const facing = normals[p] * surfaceNormal.x + normals[p + 1] * surfaceNormal.y + normals[p + 2] * surfaceNormal.z
    if (d >= 1 || facing < .05) continue
    const weight = (1 - d * d) ** 3 * THREE.MathUtils.smoothstep(facing, .05, .5)
    uv[i * 2] = THREE.MathUtils.clamp(uv[i * 2] - delta.x * weight, .005, .995)
    uv[i * 2 + 1] = THREE.MathUtils.clamp(uv[i * 2 + 1] - delta.y * weight, .005, .995)
  }
}
