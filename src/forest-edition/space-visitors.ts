import * as THREE from 'three'
import { forestOrientation, forestTangent } from './edition-forest-extension-math.ts'

export type VisitorTarget = { id: string; name: string; anchor: THREE.Group; direction: THREE.Vector3; model: { group: THREE.Group } }
type Visitor = { id: number; anchor: THREE.Group; body: THREE.Group; limbs: THREE.Group[]; direction: THREE.Vector3; heading: THREE.Vector3; cooldown: number; age: number; controlled: boolean }
type Injury = { target: VisitorTarget; rotation: THREE.Quaternion; position: THREE.Vector3; stars: THREE.Group; button: HTMLButtonElement }
type Flight = { ship: THREE.Group; direction: THREE.Vector3; start: THREE.Vector3; landing: THREE.Vector3; age: number; visitor?: Visitor }

// A low-poly white suit, dark visor and lemon/cyan equipment, drawn directly in 3D.
function astronaut() {
  const group = new THREE.Group(); group.name = '외부 우주인'
  const white = new THREE.MeshStandardMaterial({ color: '#f1f7fa', roughness: .7, flatShading: true })
  const cyan = new THREE.MeshStandardMaterial({ color: '#42c8e9', roughness: .45 })
  const lemon = new THREE.MeshStandardMaterial({ color: '#f5e65c', roughness: .6 })
  const black = new THREE.MeshStandardMaterial({ color: '#121d33', metalness: .35, roughness: .22 })
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, p: number[], scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...p as [number, number, number]); mesh.scale.set(...scale as [number, number, number]); mesh.castShadow = true; group.add(mesh); return mesh
  }
  const box = () => new THREE.BoxGeometry(1, 1, 1)
  part(box(), white, [0, .7, 0], [.48, .55, .34])
  part(new THREE.IcosahedronGeometry(.34, 1), white, [0, 1.23, 0], [1, 1.07, 1])
  part(new THREE.IcosahedronGeometry(.29, 1), lemon, [0, 1.24, .16], [1, 1, .55])
  part(new THREE.IcosahedronGeometry(.26, 1), black, [0, 1.24, .205], [1, 1, .52])
  part(box(), cyan, [0, .94, .02], [.47, .07, .4])
  part(box(), cyan, [0, .72, .19], [.27, .22, .05])
  part(box(), lemon, [0, .71, .23], [.18, .14, .025])
  part(box(), white, [0, .73, -.27], [.36, .42, .19])
  const limbs: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    limbs.push(part(box(), white, [side * .35, .71, 0], [.17, .47, .21]))
    part(box(), cyan, [side * .35, .51, 0], [.185, .07, .22])
    limbs.push(part(box(), white, [side * .135, .29, 0], [.2, .4, .23]))
    part(box(), cyan, [side * .135, .095, .065], [.22, .09, .33])
    part(box(), white, [side * .135, .15, .065], [.22, .1, .33])
  }
  group.scale.setScalar(.54)
  const joints = limbs.map(mesh => {
    const joint = new THREE.Group(); joint.position.copy(mesh.position); mesh.position.set(0, 0, 0); joint.add(mesh); group.add(joint); return joint
  })
  return { group, limbs: joints }
}
function spaceship() {
  const group = new THREE.Group(); group.name = '방문 우주선'
  const hull = new THREE.MeshStandardMaterial({ color: '#d9f3fa', metalness: .4, roughness: .4, flatShading: true })
  const base = new THREE.Mesh(new THREE.SphereGeometry(.9, 12, 8), hull); base.scale.y = .25; group.add(base)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.48, 12, 8), new THREE.MeshStandardMaterial({ color: '#76d9ed', metalness: .2, roughness: .12, transparent: true, opacity: .8 })); dome.position.y = .22; dome.scale.y = .8; group.add(dome)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.69, .055, 6, 24), new THREE.MeshStandardMaterial({ color: '#f3df75', emissive: '#ab872b', emissiveIntensity: .4 })); rim.rotation.x = Math.PI / 2; group.add(rim)
  for (let i = 0; i < 8; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.065, 6, 4), new THREE.MeshBasicMaterial({ color: i % 2 ? '#a6f2fa' : '#ffed88' })); light.position.set(Math.cos(i * Math.PI / 4) * .79, -.04, Math.sin(i * Math.PI / 4) * .79); group.add(light)
  }
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(.4, .04, .8), hull); ramp.name = '우주선 출입로'; ramp.position.set(0, -.19, .66); ramp.rotation.x = .2; ramp.visible = false; group.add(ramp)
  return group
}
function dispose(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>()
  object.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)) } })
  object.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
}

export function createSpaceVisitors({ root, world, camera, canvas, terrain, trees, getTargets, canAttack, allowed }: {
  root: HTMLElement; world: THREE.Group; camera: THREE.Camera; canvas: HTMLCanvasElement
  terrain: (p: THREE.Vector3) => { radius: number; waterDistance: number }; trees: THREE.Vector3[]
  getTargets: () => VisitorTarget[]; canAttack: () => boolean; allowed: () => boolean
}) {
  const visitors: Visitor[] = []; const injured = new Map<string, Injury>()
  const effects: { mesh: THREE.Mesh; age: number; start: THREE.Vector3; end: THREE.Vector3 }[] = []
  let flight: Flight | null = null; let nextVisit = 28 + Math.random() * 18; let serial = 0; let elapsed = 0
  const immunity = new Map<string, number>()
  const count = document.createElement('span'); count.className = 'space-outsider-count'; root.querySelector('.edition-forest-residents')!.append(count)
  const panel = document.createElement('aside'); panel.className = 'space-visitors'; panel.setAttribute('aria-label', '외부인 소식'); panel.innerHTML = '<p class="space-visitors__status" role="status"></p>'; root.append(panel)
  const status = panel.querySelector<HTMLElement>('.space-visitors__status')!
  const labels = document.createElement('div'); labels.className = 'space-treatment-labels'; root.append(labels)
  const sync = () => {
    count.innerHTML = `<strong>${visitors.length}</strong>명의 외부인`
    root.dataset.outsiders = String(visitors.length); root.dataset.injured = String(injured.size)
  }
  function remove(id: number) {
    const index = visitors.findIndex(v => v.id === id); if (index < 0) return
    dispose(visitors[index].anchor); visitors.splice(index, 1)
    // Removing the last visitor never stops the scheduler. Start a fresh random
    // interval, including when a previous visit was waiting at the population cap.
    nextVisit = 35 + Math.random() * 55
    status.textContent = '우주인이 싱크홀로 떠났어요. 다른 외부인이 다시 찾아올 수도 있어요.'; sync()
  }
  function spawn(direction: THREE.Vector3) {
    const model = astronaut(); const anchor = new THREE.Group(); anchor.add(model.group); world.add(anchor)
    const visitor: Visitor = { id: ++serial, anchor, body: model.group, limbs: model.limbs, direction: direction.clone(), heading: forestTangent(direction), cooldown: 6, age: 0, controlled: false }
    anchor.name = `외부인 ${visitor.id}`; anchor.userData.visitorId = visitor.id; visitors.push(visitor)
    status.textContent = '우주인을 길게 잡아 싱크홀에 놓으면 방출할 수 있어요.'; sync(); return visitor
  }
  function launch() {
    const targets = getTargets()
    if (!targets.length) return
    const front = camera.getWorldPosition(new THREE.Vector3()).normalize().applyQuaternion(world.getWorldQuaternion(new THREE.Quaternion()).invert())
    targets.sort((a, b) => b.direction.dot(front) - a.direction.dot(front))
    const destination = targets[0].direction
    let direction = destination.clone()
    for (let i = 0; i < 100; i++) {
      const candidate = destination.clone().addScaledVector(forestTangent(destination).applyAxisAngle(destination, i * 2.39996), .13 + i * .003).normalize()
      if (terrain(candidate).waterDistance > .065 && trees.every(t => t.distanceTo(candidate) > .12)) { direction = candidate; break }
    }
    const ship = spaceship(); world.add(ship)
    const landing = direction.clone().multiplyScalar(terrain(direction).radius + .52)
    const start = direction.clone().multiplyScalar(17).addScaledVector(forestTangent(direction), 12)
    ship.position.copy(start); ship.quaternion.copy(forestOrientation(direction, forestTangent(direction)))
    flight = { ship, direction, start, landing, age: 0 }; root.dataset.visitorFlight = 'approaching'; status.textContent = '저 멀리서 우주선이 다가오고 있어요…'
  }
  function knockDown(target: VisitorTarget, visitor: Visitor) {
    // Meetings keep ownership of participants until everyone has returned home.
    // Ships and visitors still move, but attacks must not cancel that lifecycle.
    if (!canAttack() || injured.has(target.id)) return
    const stars = new THREE.Group(); stars.name = '치료를 기다리는 별'; target.anchor.add(stars)
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(.075, 0), new THREE.MeshBasicMaterial({ color: '#ffe574' })); star.position.set(Math.cos(i * 2.094) * .3, 1, Math.sin(i * 2.094) * .3); stars.add(star)
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'space-heal'; button.dataset.targetId = target.id
    button.textContent = '✚ 치료하기'; button.setAttribute('aria-label', `${target.name} 치료하기`); button.hidden = true
    button.onclick = event => { event.stopPropagation(); healTarget(target.id) }
    labels.append(button)
    injured.set(target.id, { target, stars, button, rotation: target.model.group.quaternion.clone(), position: target.model.group.position.clone() })
    target.anchor.userData.incapacitated = true; target.model.group.rotation.z = Math.PI * .42
    target.model.group.position.y = .12
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#f5bcff', transparent: true, opacity: .9 })); world.add(pulse)
    effects.push({ mesh: pulse, age: 0, start: visitor.anchor.position.clone().addScaledVector(visitor.direction, .4), end: target.anchor.position.clone().addScaledVector(target.direction, .25) })
    status.textContent = `${target.name} · 치료가 필요해요. 치료하기를 눌러 깨워 주세요.`; sync()
  }
  function healTarget(id: string) {
    if (!allowed()) return
    const injury = injured.get(id); if (!injury) return
    const { target, rotation, position, stars, button } = injury
    target.anchor.userData.incapacitated = false; target.model.group.quaternion.copy(rotation); target.model.group.position.copy(position); dispose(stars); button.remove()
    injured.delete(id); immunity.set(id, 10); status.textContent = `${target.name} · 건강해졌어요! 10초 동안 보호받아요.`; sync()
  }
  function updateLabels() {
    if (!injured.size) return
    const visible = allowed() && world.visible
    const rect = canvas.getBoundingClientRect(), parent = root.getBoundingClientRect()
    camera.updateMatrixWorld(); world.updateWorldMatrix(true, false)
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3())
    const center = world.getWorldPosition(new THREE.Vector3())
    const rotation = world.getWorldQuaternion(new THREE.Quaternion())
    for (const { target, button } of injured.values()) {
      if (!visible || !target.anchor.parent) { button.hidden = true; continue }
      const normal = target.direction.clone().applyQuaternion(rotation)
      const base = target.anchor.getWorldPosition(new THREE.Vector3())
      const point = base.clone().addScaledVector(normal, .62).project(camera)
      // Keep labels on their own hemisphere; never show a back-side patient's
      // button over a healthy animal on the front of the globe.
      const facing = base.clone().sub(center).dot(cameraPosition.clone().sub(base)) > 0
      const hidden = !facing || point.z < -1 || point.z > 1 || Math.abs(point.x) > .96 || Math.abs(point.y) > .94
      if (button.hidden !== hidden) button.hidden = hidden
      const left = `${rect.left - parent.left + (point.x + 1) * rect.width / 2}px`, top = `${rect.top - parent.top + (1 - point.y) * rect.height / 2}px`
      if (button.style.left !== left) button.style.left = left
      if (button.style.top !== top) button.style.top = top
    }
  }
  function update(dt: number) {
    if (!allowed()) return
    elapsed += dt
    for (const [id, remaining] of immunity) { if (remaining <= dt) immunity.delete(id); else immunity.set(id, remaining - dt) }
    for (const [id, injury] of injured) {
      if (!injury.target.anchor.parent) { dispose(injury.stars); injury.button.remove(); injured.delete(id); sync(); continue }
      injury.stars.rotation.y = elapsed * 2
      injury.target.model.group.rotation.z = Math.PI * .42
      injury.target.model.group.position.y = .12
    }
    nextVisit -= dt
    if (!flight && nextVisit <= 0 && visitors.length < 3) { launch(); nextVisit = 65 + Math.random() * 55 }
    if (flight) {
      const f = flight; f.age += dt
      if (f.age < 5) f.ship.position.lerpVectors(f.start, f.landing, THREE.MathUtils.smoothstep(f.age, 0, 5))
      else if (f.age < 8) {
        root.dataset.visitorFlight = 'landing'; f.ship.getObjectByName('우주선 출입로')!.visible = true
        if (!f.visitor) f.visitor = spawn(f.direction)
      } else {
        root.dataset.visitorFlight = 'departing'
        f.ship.position.lerpVectors(f.landing, f.start.clone().addScaledVector(forestTangent(f.direction), -20), ((f.age - 8) / 4) ** 2)
        if (f.age >= 12) { dispose(f.ship); flight = null; root.dataset.visitorFlight = 'idle' }
      }
    }
    for (let i = visitors.length - 1; i >= 0; i--) {
      const v = visitors[i]; v.age += dt
      if (v.controlled) continue
      v.cooldown -= dt
      const targets = getTargets().filter(t => !t.anchor.userData.incapacitated && !immunity.has(t.id))
      targets.sort((a, b) => a.direction.distanceToSquared(v.direction) - b.direction.distanceToSquared(v.direction))
      const target = targets[0]
      if (target && v.age > 3) {
        const distance = target.direction.distanceTo(v.direction)
        const heading = target.direction.clone().addScaledVector(v.direction, -target.direction.dot(v.direction)).normalize()
        if (distance > .11) {
          for (const angle of [0, .6, -.6, 1.2, -1.2, 1.9, -1.9]) {
            const forward = heading.clone().applyAxisAngle(v.direction, angle)
            const next = v.direction.clone().addScaledVector(forward, dt * .38 / 5.4).normalize()
            if (trees.some(t => next.distanceTo(t) < Math.min(.085, v.direction.distanceTo(t)) - .000001)) continue
            v.direction.copy(next); v.heading.copy(forward); break
          }
        }
        if (distance < .23 && v.cooldown <= 0 && canAttack()) { knockDown(target, v); v.cooldown = 7 }
      } else if (v.age < 3) {
        // Step down the open ramp before starting to chase anyone.
        v.direction.addScaledVector(v.heading, dt * .065).normalize()
      }
      v.heading.addScaledVector(v.direction, -v.heading.dot(v.direction)).normalize()
      v.anchor.position.copy(v.direction).multiplyScalar(Math.max(terrain(v.direction).radius, 5.08) + .025)
      v.anchor.quaternion.copy(forestOrientation(v.direction, v.heading))
      v.body.position.y = Math.abs(Math.sin(elapsed * 7)) * .025
      v.limbs.forEach((limb, n) => { limb.rotation.x = Math.sin(elapsed * 7 + n * Math.PI) * .32 })
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]; effect.age += dt; effect.mesh.position.lerpVectors(effect.start, effect.end, Math.min(1, effect.age / .35)); effect.mesh.scale.setScalar(1 + effect.age)
      if (effect.age > .5) { dispose(effect.mesh); effects.splice(i, 1) }
    }
  }
  sync()
  return { update, updateLabels, visitors, remove }
}
