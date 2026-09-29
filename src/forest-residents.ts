import * as THREE from 'three'
import { buildResident, type ResidentModel } from './forest-resident-model'
import { createResidentPersistence } from './forest-resident-storage'
import { normalizeResidentName, nextResidentName } from './forest-resident-names'
import type { ResidentAnalysis } from './forest-resident-types'

type Options = {
  root: HTMLElement; world: THREE.Group; scene: THREE.Scene; camera: THREE.PerspectiveCamera
  terrain: (p: THREE.Vector3) => { radius: number; waterDistance: number }
  trees: THREE.Vector3[]
  onIntroduction: (active: boolean) => void
  onCount: (count: number) => void
}
type Walker = { id: string; name: string; model: ResidentModel; anchor: THREE.Group; direction: THREE.Vector3; heading: THREE.Vector3; speed: number; turn: number; decisionAt: number; restingUntil: number; phase: number; scale: number }
type Arrival = { walker: Walker; startAt: number; initialPosition: THREE.Vector3; initialQuaternion: THREE.Quaternion; initialScale: number; initialCamera: THREE.Vector3 }
const UP = new THREE.Vector3(0, 1, 0)
const quat = new THREE.Quaternion()
function tangent(direction: THREE.Vector3) {
  const candidate = Math.abs(direction.y) > .95 ? new THREE.Vector3(1, 0, 0) : UP
  return new THREE.Vector3().crossVectors(candidate, direction).normalize()
}
function orientation(direction: THREE.Vector3, heading: THREE.Vector3) {
  const right = new THREE.Vector3().crossVectors(direction, heading).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, direction, heading))
}
export function createResidents({ root, world, scene, camera, terrain, trees, onIntroduction, onCount }: Options) {
  const walkers: Walker[] = []; let arrival: Arrival | null = null; let lastTime = 0
  const welcome = document.createElement('div'); welcome.className = 'forest-welcome'; welcome.hidden = true
  welcome.innerHTML = '<span class="forest-welcome__eyebrow">A NEW NEIGHBOR, A NEW STORY</span><h3>우리, 숲에서 만나요.</h3><p>당신의 모습으로 태어난 작은 이웃이에요.</p><span class="forest-welcome__name"></span>'
  root.append(welcome)
  const counter = document.createElement('div'); counter.className = 'forest-residents'; counter.innerHTML = '<strong>0</strong>명의 이웃'; root.append(counter)
  const persistence = createResidentPersistence(root, (model, state) => {
    try {
      let direction = state.direction?.length === 3 && state.direction.every(Number.isFinite) ? new THREE.Vector3().fromArray(state.direction).normalize() : findHome()
      if (direction.lengthSq() < .5 || !walkable(direction)) direction = findHome()
      const heading = state.heading?.length === 3 && state.heading.every(Number.isFinite) ? new THREE.Vector3().fromArray(state.heading) : tangent(direction)
      heading.addScaledVector(direction, -heading.dot(direction)); if (heading.lengthSq() < .001) heading.copy(tangent(direction)); heading.normalize()
      const scale = .74 / Math.max(1.5, model.height); const anchor = new THREE.Group(); anchor.add(model.group); world.add(anchor)
      anchor.position.copy(direction).multiplyScalar(terrain(direction).radius + .012); anchor.quaternion.copy(orientation(direction, heading)); anchor.scale.setScalar(scale)
      walkers.push({ id: state.id, name: state.name || nextResidentName(walkers.map(w => w.name)), model, anchor, direction, heading, scale, speed: .13 + Math.random() * .065, turn: 0, decisionAt: 0, restingUntil: performance.now() + 1000, phase: Math.random() * 10 })
      updateDiagnostics()
    } catch (error) { model.dispose(); throw error }
  }, removeStoredResident, () => walkers)
  function removeStoredResident(id: string) {
    const walker = walkers.find(w => w.id === id); if (!walker) return

    walker.anchor.removeFromParent(); walker.model.dispose(); walkers.splice(walkers.indexOf(walker), 1); updateDiagnostics()
  }

  function walkable(direction: THREE.Vector3, self?: Walker) {
    if (terrain(direction).waterDistance < .057) return false
    if (trees.some(tree => tree.distanceToSquared(direction) < .0047)) return false
    return !walkers.some(other => other !== self && other.direction.distanceToSquared(direction) < .0058)
  }
  function findHome() {
    const worldRotation = world.getWorldQuaternion(new THREE.Quaternion())
    const front = camera.position.clone().normalize().applyQuaternion(worldRotation.invert())
    const across = tangent(front); const vertical = new THREE.Vector3().crossVectors(front, across).normalize()
    // Favor the visible central meadow so each arrival can be seen immediately.
    for (let i = 0; i < 160; i++) {
      const angle = i * 2.39996; const radius = .018 * Math.sqrt(i)
      const point = front.clone().addScaledVector(across, Math.cos(angle) * radius).addScaledVector(vertical, Math.sin(angle) * radius).normalize()
      if (walkable(point)) return point
    }
    for (let i = 0; i < 1000; i++) {
      const point = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize()
      if (walkable(point)) return point
    }
    throw new Error('입주할 빈 땅을 찾지 못했어요. 다시 시도해 주세요.')
  }
  function updateDiagnostics() {
    counter.querySelector('strong')!.textContent = String(walkers.length)
    root.dataset.residents = String(walkers.length); onCount(walkers.length)
  }
  async function create(photo: HTMLCanvasElement, analysis: ResidentAnalysis, requestedName = '') {
    await persistence.ready
    if (arrival) throw new Error('앞서 만든 주민이 입주하고 있어요. 잠시 뒤 다시 시도해 주세요.')
    const direction = findHome(); const model = buildResident(photo, analysis)
    const anchor = new THREE.Group(); anchor.add(model.group); scene.add(anchor)
    const heading = tangent(direction).applyAxisAngle(direction, Math.random() * Math.PI * 2)
    const scale = .74 / Math.max(1.5, model.height)
    const name = normalizeResidentName(requestedName) || nextResidentName(walkers.map(w => w.name))
    const walker: Walker = { id: model.group.uuid, name, model, anchor, direction, heading, speed: .13 + Math.random() * .065, turn: 0, decisionAt: 0, restingUntil: 0, phase: Math.random() * 10, scale }
    // Camera-relative presentation keeps the new character upright after arbitrary globe rotation.
    camera.getWorldQuaternion(quat); anchor.quaternion.copy(quat)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat)
    const viewHeight = 2 * camera.position.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const initialScale = Math.min(viewHeight * .58, viewHeight * camera.aspect * .58) / model.height
    const initialPosition = up.multiplyScalar(-model.height * initialScale * .46).addScaledVector(right, 0)
    anchor.position.copy(initialPosition); anchor.scale.setScalar(initialScale)
    arrival = { walker, startAt: performance.now(), initialPosition: initialPosition.clone(), initialQuaternion: quat.clone(), initialScale, initialCamera: camera.position.clone() }
    world.visible = false; welcome.hidden = false; welcome.classList.remove('is-landing'); root.classList.add('is-introducing')
    welcome.querySelector('.forest-welcome__name')!.textContent = `${name} · ${model.label}`
    root.dataset.residentName = name; root.dataset.residentKind = String(model.group.userData.kind); root.dataset.residentFingerprint = String(model.fingerprint); root.dataset.mappedParts = model.mappedParts.join(','); root.dataset.residentPhase = 'preview'
    onIntroduction(true)
  }
  function updateArrival(now: number) {
    if (!arrival) return
    const a = arrival; const elapsed = (now - a.startAt) / 1000
    if (elapsed < 3.4) {
      a.walker.anchor.quaternion.copy(a.initialQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.sin(elapsed * 1.3) * .23))
      a.walker.anchor.position.copy(a.initialPosition).add(new THREE.Vector3(0, Math.sin(elapsed * 2.4) * .035, 0))
      return
    }
    world.visible = true; welcome.classList.add('is-landing'); root.dataset.residentPhase = 'landing'
    const progress = THREE.MathUtils.clamp((elapsed - 3.4) / 2.7, 0, 1); const ease = progress * progress * (3 - 2 * progress)
    const destination = world.localToWorld(a.walker.direction.clone().multiplyScalar(terrain(a.walker.direction).radius + .015))
    const destinationRotation = world.getWorldQuaternion(new THREE.Quaternion()).multiply(orientation(a.walker.direction, a.walker.heading))
    const lift = camera.position.clone().normalize().multiplyScalar(Math.sin(progress * Math.PI) * 2)
    a.walker.anchor.position.lerpVectors(a.initialPosition, destination, ease).add(lift)
    a.walker.anchor.quaternion.slerpQuaternions(a.initialQuaternion, destinationRotation, ease)
    a.walker.anchor.scale.setScalar(THREE.MathUtils.lerp(a.initialScale, a.walker.scale, ease))
    if (progress >= 1) {
      world.attach(a.walker.anchor); a.walker.anchor.position.copy(a.walker.direction).multiplyScalar(terrain(a.walker.direction).radius + .015)
      a.walker.anchor.quaternion.copy(orientation(a.walker.direction, a.walker.heading)); a.walker.anchor.scale.setScalar(a.walker.scale)
      a.walker.decisionAt = now + 1600; a.walker.restingUntil = now + 1300; walkers.push(a.walker); void persistence.add(a.walker); arrival = null
      welcome.hidden = true; root.classList.remove('is-introducing'); root.dataset.residentPhase = 'walking'; updateDiagnostics(); onIntroduction(false)
    }
  }
  function update(now: number) {
    const dt = Math.min(.05, Math.max(0, (now - (lastTime || now)) / 1000)); lastTime = now
    persistence.tick()
    updateArrival(now)
    for (const walker of walkers) {
      if (now > walker.decisionAt) {
        walker.turn = (Math.random() - .5) * 1.0; walker.decisionAt = now + 2200 + Math.random() * 4800
        if (Math.random() < .25) walker.restingUntil = now + 900 + Math.random() * 2300
      }
      const moving = now > walker.restingUntil
      if (moving) {
        walker.heading.applyAxisAngle(walker.direction, walker.turn * dt).normalize()
        const lookAhead = walker.direction.clone().addScaledVector(walker.heading, .035).normalize()
        if (!walkable(lookAhead, walker)) { walker.heading.applyAxisAngle(walker.direction, Math.PI * (.55 + Math.random() * .5)); walker.turn = 0; walker.restingUntil = now + 200 }
        else {
          const next = walker.direction.clone().addScaledVector(walker.heading, walker.speed * dt / terrain(walker.direction).radius).normalize()
          if (walkable(next, walker)) walker.direction.copy(next)
        }
        walker.heading.addScaledVector(walker.direction, -walker.heading.dot(walker.direction)).normalize()
        walker.phase += dt * 8
      }
      walker.anchor.position.copy(walker.direction).multiplyScalar(terrain(walker.direction).radius + .012)
      walker.anchor.quaternion.copy(orientation(walker.direction, walker.heading))
      const gait = moving ? Math.sin(walker.phase) * .38 : Math.sin(now / 750) * .025
      walker.model.limbs.forEach((limb, i) => { limb.rotation.x = gait * [1, -1, -1, 1][i] })
      walker.model.group.position.y = moving ? Math.abs(Math.sin(walker.phase)) * .025 : Math.sin(now / 800) * .008
      if (walker.model.head) walker.model.head.rotation.y = Math.sin(now / 1700 + walker.phase * .02) * .15
    }
    if (walkers.length) {
      const d = walkers[0].direction; root.dataset.residentPosition = `${d.x.toFixed(5)},${d.y.toFixed(5)},${d.z.toFixed(5)}`
    }
  }
  function stop() {
    void persistence.flush()
    lastTime = 0
    if (arrival) {
      scene.remove(arrival.walker.anchor); arrival.walker.model.dispose(); arrival = null
      world.visible = true; welcome.hidden = true; root.classList.remove('is-introducing'); root.dataset.residentPhase = walkers.length ? 'walking' : 'idle'; onIntroduction(false)
    }
  }
  return { ready: persistence.ready, create, update, stop, get introducing() { return !!arrival } }
}
