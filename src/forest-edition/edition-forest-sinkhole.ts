import * as THREE from 'three'
import { forestTangent } from './edition-forest-extension-math'

type Options = { root: HTMLElement; canvas: HTMLCanvasElement; world: THREE.Group; camera: THREE.PerspectiveCamera;
  terrain: (p: THREE.Vector3) => { radius: number }; free: (p: THREE.Vector3) => boolean;
  onShape: (center: THREE.Vector3, amount: number) => void }
export function createForestSinkhole({ root, canvas, world, camera, terrain, free, onShape }: Options) {
  const group = new THREE.Group(); group.visible = false; world.add(group)
  const center = new THREE.Vector3(0, 0, 1); const radius = .58
  const earth = new THREE.MeshStandardMaterial({ color: '#807198', roughness: 1, side: THREE.DoubleSide })
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(radius, .18, .72, 64, 4, true), earth); funnel.position.y = -.32; group.add(funnel)
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(.22, 48), new THREE.MeshBasicMaterial({ color: '#171d1a', side: THREE.DoubleSide })); bottom.rotation.x = -Math.PI / 2; bottom.position.y = -.679; group.add(bottom)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, .044, 10, 64), new THREE.MeshStandardMaterial({ color: '#c6b3e1', roughness: .98 })); rim.rotation.x = Math.PI / 2; rim.position.y = .036; group.add(rim)
  const rimGeometry = new THREE.IcosahedronGeometry(.07, 0)
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * Math.PI * 2; const rock = new THREE.Mesh(rimGeometry, earth)
    rock.position.set(Math.cos(angle) * .61, .025, Math.sin(angle) * .61); rock.rotation.set(i * .4, angle, i * .23); rock.scale.set(1, .55, .7); group.add(rock)
  }
  const label = document.createElement('div'); label.className = 'edition-forest-sinkhole-label'; label.hidden = true; label.textContent = '싱크홀 · 놓으면 영구 방출'; root.append(label)
  let amount = 0; let target = 0; let hovered = false
  function contains(p: THREE.Vector3) { return target === 1 && amount > .25 && p.distanceTo(center) * terrain(center).radius < radius * amount * .91 }
  function hide() { amount = 0; target = 0; group.visible = false; label.hidden = true; hovered = false; onShape(center, 0); root.dataset.sinkhole = 'closed' }
  return {
    center,
    contains,
    get active() { return target > 0 },
    open(avoid: THREE.Vector3) {
      const rotation = world.getWorldQuaternion(new THREE.Quaternion())
      const front = camera.position.clone().normalize().applyQuaternion(rotation.invert())
      const across = forestTangent(front); const vertical = new THREE.Vector3().crossVectors(front, across)
      const preferred = front.clone().addScaledVector(across, .34).addScaledVector(vertical, -.25).normalize()
      let spot: THREE.Vector3 | null = null
      for (let i = 0; i < 480; i++) {
        const angle = i * 2.39996; const distance = .02 * Math.sqrt(i)
        const point = preferred.clone().addScaledVector(across, Math.cos(angle) * distance).addScaledVector(vertical, Math.sin(angle) * distance).normalize()
        if (point.distanceTo(avoid) > .23 && free(point) && [across, vertical].every(axis => [-1, 1].every(sign => free(point.clone().addScaledVector(axis, sign * .11).normalize())))) { spot = point; break }
      }
      if (!spot) { hide(); return false }
      center.copy(spot); amount = 0; target = 1; hovered = false; group.visible = true; label.hidden = false
      group.position.copy(center).multiplyScalar(terrain(center).radius + .025); group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), center)
      root.dataset.sinkhole = 'open'; return true
    },
    hover(value: boolean) { hovered = value; label.classList.toggle('is-targeted', value); label.textContent = value ? '여기에 놓으면 영구 방출됩니다' : '싱크홀 · 놓으면 영구 방출'; if (target) root.dataset.sinkhole = value ? 'targeted' : 'open' },
    close() { target = 0; hovered = false; label.hidden = true; root.dataset.sinkhole = 'closing' },
    hide,
    update(dt: number) {
      if (!group.visible) return
      amount = THREE.MathUtils.damp(amount, target, target ? 10 : 7, dt)
      if (!target && amount < .005) { hide(); return }
      group.scale.setScalar(amount); onShape(center, amount)
      rim.material.color.set(hovered ? '#edb7d0' : '#c6b3e1')
      const worldPoint = world.localToWorld(center.clone().multiplyScalar(terrain(center).radius + .2)); const point = worldPoint.project(camera)
      const rect = canvas.getBoundingClientRect(); const parent = root.getBoundingClientRect()
      label.style.left = `${rect.left - parent.left + (point.x + 1) * rect.width / 2}px`; label.style.top = `${rect.top - parent.top + (1 - point.y) * rect.height / 2 + 32}px`
      label.hidden = !target || point.z > 1 || world.localToWorld(center.clone()).dot(camera.position) < 0
    },
  }
}
