import * as THREE from 'three'
import { setForestText } from '../forest-performance'
import { buildResident, type ResidentModel } from './edition-forest-resident-model'
import { createResidentPersistence } from './edition-forest-resident-storage'
import { normalizeResidentName, nextResidentName } from './edition-forest-resident-names'
import type { ResidentAnalysis } from './edition-forest-resident-types'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createForestTextureEditor } from './edition-forest-texture-editor'
import { createForestNavigation, meetingSlots } from './edition-forest-extension-math'
import { createForestSinkhole } from './edition-forest-sinkhole'
import './edition-forest-extended.css'
import { createForestDialogue } from './edition-forest-dialogue'
import type { WildlifeAnimal } from './wildlife'
import { wildlifeVoices } from './wildlife-voices'
import { createSpaceVisitors } from './space-visitors'

type Options = {
  root: HTMLElement; world: THREE.Group; scene: THREE.Scene; camera: THREE.PerspectiveCamera
  terrain: (p: THREE.Vector3) => { radius: number; waterDistance: number }
  trees: THREE.Vector3[]
  canvas: HTMLCanvasElement; controls: OrbitControls; ground: THREE.Mesh; meetingCenter: THREE.Vector3
  canInteract: () => boolean
  setSinkhole?: (center: THREE.Vector3, amount: number) => void
  onIntroduction: (active: boolean) => void
  onCount: (count: number) => void
  wildlife?: readonly WildlifeAnimal[]
}
type Walker = { id: string; name: string; routeAt: number; routeDistance: number; route: THREE.Vector3[]; meetingTarget: THREE.Vector3 | null; settled: boolean; collision: number; model: ResidentModel; anchor: THREE.Group; direction: THREE.Vector3; heading: THREE.Vector3; speed: number; turn: number; decisionAt: number; restingUntil: number; phase: number; scale: number }
type Arrival = { walker: Walker; startAt: number; initialPosition: THREE.Vector3; initialQuaternion: THREE.Quaternion; initialScale: number; landingAt: number | null }
type Trackable = Walker | WildlifeAnimal
type MeetingHome = { direction: THREE.Vector3; heading: THREE.Vector3; position: THREE.Vector3; rotation: THREE.Quaternion; modelPosition: THREE.Vector3; modelRotation: THREE.Quaternion; trail: THREE.Vector3[]; bubble?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial> }
const UP = new THREE.Vector3(0, 1, 0)
const quat = new THREE.Quaternion()
function tangent(direction: THREE.Vector3) {
  const candidate = Math.abs(direction.y) > .95 ? new THREE.Vector3(1, 0, 0) : UP
  return new THREE.Vector3().crossVectors(candidate, direction).normalize()
}
function orientation(direction: THREE.Vector3, heading: THREE.Vector3) {
  const forward = heading.clone().addScaledVector(direction, -heading.dot(direction))
  if (forward.lengthSq() < .00001) forward.copy(tangent(direction))
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(direction, forward).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, direction, forward))
}
export function createExtendedResidents({ root, world, scene, camera, terrain, trees, canvas, controls, ground, meetingCenter, canInteract, setSinkhole = () => {}, onIntroduction, onCount, wildlife = [] }: Options) {
  const walkers: Walker[] = []; let arrival: Arrival | null = null; let lastTime = 0
  const meetingHomes = new Map<Walker, MeetingHome>()
  const meetingGuests = new Map<Walker, WildlifeAnimal>()
  const welcome = document.createElement('div'); welcome.className = 'edition-forest-welcome'; welcome.hidden = true
  welcome.innerHTML = '<span class="edition-forest-welcome__eyebrow">ONE SMALL FRIEND, ONE BIG UNIVERSE ✦</span><h3>우리 행성에 온 걸 환영해!</h3><p>별빛 아래 함께 살아갈 작은 친구예요.</p><span class="edition-forest-welcome__name"></span>'
  root.append(welcome)
  const counter = document.createElement('div'); counter.className = 'edition-forest-residents'; counter.innerHTML = '<strong>0</strong>명의 행성 주민'; root.append(counter)
  const persistence = createResidentPersistence(root, (model, state) => {
    try {
      let direction = state.direction?.length === 3 && state.direction.every(Number.isFinite) ? new THREE.Vector3().fromArray(state.direction).normalize() : findHome()
      if (direction.lengthSq() < .5 || !walkable(direction)) direction = findHome()
      const heading = state.heading?.length === 3 && state.heading.every(Number.isFinite) ? new THREE.Vector3().fromArray(state.heading) : tangent(direction)
      heading.addScaledVector(direction, -heading.dot(direction)); if (heading.lengthSq() < .001) heading.copy(tangent(direction)); heading.normalize()
      const scale = .74 / Math.max(1.5, model.height); const anchor = new THREE.Group(); anchor.add(model.group); world.add(anchor)
      anchor.position.copy(direction).multiplyScalar(terrain(direction).radius + .012); anchor.quaternion.copy(orientation(direction, heading)); anchor.scale.setScalar(scale)
      walkers.push({ routeAt: 0, routeDistance: Infinity, route: [], meetingTarget: null, settled: false, collision: Math.max(.28, new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3()).x * scale * .52), id: state.id, name: state.name || nextResidentName(walkers.map(w => w.name)), model, anchor, direction, heading, scale, speed: .13 + Math.random() * .065, turn: 0, decisionAt: 0, restingUntil: performance.now() + 1000, phase: Math.random() * 10 })
      updateDiagnostics()
    } catch (error) { model.dispose(); throw error }
  }, removeStoredResident, () => walkers.map(w => {
    const home = meetingHomes.get(w)
    return home ? { ...w, direction: home.direction, heading: home.heading } : w
  }))
  function removeStoredResident(id: string) {
    if (departure?.walker.id === id) { finishDeparture(departure); return }
    const walker = walkers.find(w => w.id === id); if (!walker) return
    if (held?.walker === walker) finishGesture(true)
    if (follow?.walker === walker) leaveFollow(true)
    if (meetingHomes.size) stopMeeting(true)
    walker.anchor.removeFromParent(); walker.model.dispose(); walkers.splice(walkers.indexOf(walker), 1); updateDiagnostics()
  }

  const previewActions = document.createElement('div'); previewActions.className = 'edition-forest-preview-actions'; previewActions.hidden = true
  previewActions.innerHTML = '<button type="button" data-action="edit">✎ 모습 다듬기</button><button type="button" data-action="land">행성에 착륙하기 ↗</button>'; root.append(previewActions)
  const toolbar = document.createElement('div'); toolbar.className = 'edition-forest-extension-toolbar'
  toolbar.innerHTML = '<button type="button" class="edition-forest-meeting" disabled>✧ 주민 회의</button><button type="button" class="edition-forest-follow-exit" hidden>↶ 행성 전체 보기</button>'; root.append(toolbar)
  const meetingButton = toolbar.querySelector<HTMLButtonElement>('.edition-forest-meeting')!; const exitButton = toolbar.querySelector<HTMLButtonElement>('.edition-forest-follow-exit')!
  root.append(exitButton)
  const notice = document.createElement('p'); notice.className = 'edition-forest-extension-hint'; notice.setAttribute('role', 'status'); root.append(notice)
  const defaultHint = '동물·주민 클릭 · 함께 산책하기  /  주민·우주인을 길게 눌러 옮기기'
  notice.textContent = defaultHint
  const dialogue = createForestDialogue(root)
  const editor = createForestTextureEditor(root, canvas, camera, () => { previewActions.hidden = false })
  previewActions.querySelector<HTMLButtonElement>('[data-action="edit"]')!.onclick = () => {
    if (!arrival || arrival.landingAt !== null) return
    editor.open(arrival.walker.model, arrival.walker.anchor); previewActions.hidden = true
  }
  previewActions.querySelector<HTMLButtonElement>('[data-action="land"]')!.onclick = () => {
    if (!arrival || arrival.landingAt !== null) return
    editor.close(); previewActions.hidden = true; arrival.landingAt = performance.now()
    arrival.initialPosition.copy(arrival.walker.anchor.position); arrival.initialQuaternion.copy(arrival.walker.anchor.quaternion)
  }
  type CameraState = { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }
  let savedView: CameraState | null = null; let returning: CameraState | null = null
  let follow: { walker: Trackable; yaw: number; elevation: number; distance: number } | null = null
  let gesture: { id: number; walker: Trackable | null; startX: number; startY: number; x: number; y: number; moved: boolean; timer: number } | null = null
  let held: { walker: Walker; original: THREE.Vector3; candidate: THREE.Vector3; valid: boolean; lift: number; overSink: boolean } | null = null
  type Departure = { walker: Walker; original: THREE.Vector3; position: THREE.Vector3; startedAt: number | null; finishImmediately: boolean }
  let departure: Departure | null = null
  const sinkhole = createForestSinkhole({ root, canvas, world, camera, terrain, free: p => terrainFree(p) && walkable(p), onShape: setSinkhole })
  let meeting = false; let meetingReturning = false; let navigation: ReturnType<typeof createForestNavigation> | null = null; let meetingGeneration = 0
  const visitors = createSpaceVisitors({ root, world, camera, canvas, terrain, trees,
    getTargets: () => [...walkers.filter(w => w !== held?.walker && w !== departure?.walker), ...wildlife],
    canAttack: () => !meeting && !meetingReturning && meetingHomes.size === 0,
    allowed: () => canInteract() && !arrival && !departure && !held,
  })
  const visitorWalkers = new Map<number, Walker>()
  function getVisitorWalkers() {
    for (const v of visitors.visitors) if (!visitorWalkers.has(v.id)) {
      visitorWalkers.set(v.id, { id: `visitor-${v.id}`, name: `우주인 ${v.id}`, anchor: v.anchor, direction: v.direction, heading: v.heading,
        model: { group: v.body, limbs: v.limbs, head: null, height: .85, label: '우주인', fingerprint: 0, mappedParts: [], dispose() {} },
        scale: 1, collision: .3, routeAt: 0, routeDistance: Infinity, route: [], meetingTarget: null, settled: false, speed: .38, turn: 0, decisionAt: 0, restingUntil: 0, phase: 0 })
    }
    return [...visitorWalkers.values()]
  }
  function setVisitorHeld(w: Walker, value: boolean) {
    const visitor = visitors.visitors.find(v => v.id === w.anchor.userData.visitorId)
    if (visitor) visitor.controlled = value
  }
  const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2()
  const landingRing = new THREE.Mesh(new THREE.RingGeometry(.28, .34, 48), new THREE.MeshBasicMaterial({ color: '#f1e8a0', side: THREE.DoubleSide, depthWrite: false }))
  landingRing.visible = false; world.add(landingRing)
  function syncControls() { controls.enabled = canInteract() && !arrival && !follow && !returning && !gesture && !held && !departure }
  function leaveFollow(immediate = false) {
    dialogue.hide(); follow = null; root.classList.remove('is-following'); exitButton.hidden = true; root.dataset.cameraMode = 'globe'; delete root.dataset.followingAnimal
    const view = savedView ?? returning; savedView = null
    if (view) {
      if (immediate) { camera.position.copy(view.position); camera.up.copy(view.up); controls.target.copy(view.target); camera.lookAt(view.target); returning = null }
      else returning = view
    }
    if (!held) notice.textContent = defaultHint
    syncControls()
  }
  function select(walker: Trackable) {
    if (follow?.walker === walker) { leaveFollow(); return }
    if (!savedView) savedView = returning ?? { position: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone() }
    const animal = 'species' in walker
    returning = null; follow = { walker, yaw: 0, elevation: animal ? .48 : .39, distance: animal ? 2.3 : 2.8 }
    dialogue.show(walker.id, walker.name, animal ? wildlifeVoices[walker.species] : walker.anchor.userData.visitorId ? ['삐빅… 낯선 행성 탐사 중.'] : undefined)
    if (animal) root.dataset.followingAnimal = walker.species
    else delete root.dataset.followingAnimal
    root.classList.add('is-following'); root.dataset.cameraMode = 'follow'; exitButton.hidden = false
    notice.textContent = '드래그로 둘러보기 · 휠로 거리 조절 · 다시 클릭하면 행성으로'
    syncControls()
  }
  exitButton.onclick = () => leaveFollow()
  function updateFollow(dt: number) {
    const ease = 1 - Math.exp(-dt * 7)
    if (follow && !held) {
      const w = follow.walker; const rotation = world.getWorldQuaternion(new THREE.Quaternion())
      const normal = w.direction.clone().applyQuaternion(rotation)
      const forward = w.heading.clone().applyQuaternion(rotation); const right = new THREE.Vector3().crossVectors(normal, forward)
      const height = 'species' in w ? (['shark', 'goldfish', 'riverfish'].includes(w.species) ? .1 : .27) : .43
      const target = w.anchor.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, height)
      const desired = target.clone().addScaledVector(forward, Math.cos(follow.yaw) * Math.cos(follow.elevation) * follow.distance)
        .addScaledVector(right, Math.sin(follow.yaw) * Math.cos(follow.elevation) * follow.distance).addScaledVector(normal, Math.sin(follow.elevation) * follow.distance)
      camera.position.lerp(desired, ease); camera.up.lerp(normal, ease).normalize(); controls.target.lerp(target, ease); camera.lookAt(controls.target)
    } else if (returning) {
      camera.position.lerp(returning.position, ease); camera.up.lerp(returning.up, ease).normalize(); controls.target.lerp(returning.target, ease); camera.lookAt(controls.target)
      if (camera.position.distanceToSquared(returning.position) < .0001 && controls.target.distanceToSquared(returning.target) < .0001) {
        camera.position.copy(returning.position); camera.up.copy(returning.up); controls.target.copy(returning.target); returning = null; syncControls()
      }
    }
  }
  function setRay(event: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect(); mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
    camera.updateMatrixWorld(); world.updateMatrixWorld(true); raycaster.setFromCamera(mouse, camera)
  }
  function pickResident(event: PointerEvent) {
    setRay(event)
    const groundHit = raycaster.intersectObject(ground)[0]
    const targets: Trackable[] = [...walkers, ...wildlife, ...getVisitorWalkers()]
    const hits = raycaster.intersectObjects(targets.map(w => w.anchor), true)
    const hit = hits.find(h => !groundHit || h.distance < groundHit.distance + .02)
    if (!hit) return null
    let object: THREE.Object3D | null = hit.object
    while (object) { const walker = targets.find(w => w.anchor === object); if (walker) return walker; object = object.parent }
    return null
  }
  function nearestDrop(direction: THREE.Vector3, walker: Walker) {
    if (walkable(direction, walker)) return direction.clone()
    const across = tangent(direction); const vertical = new THREE.Vector3().crossVectors(direction, across)
    for (let i = 1; i <= 140; i++) {
      const radius = .015 * Math.sqrt(i); const angle = i * 2.39996
      const p = direction.clone().addScaledVector(across, Math.cos(angle) * radius).addScaledVector(vertical, Math.sin(angle) * radius).normalize()
      if (walkable(p, walker)) return p
    }
    return null
  }
  function grab(walker: Walker) {
    if (!gesture || !canInteract()) return
    leaveFollow(true)
    // Visitors are not meeting participants, so everyone can retrace their
    // meeting route while the visitor is being carried or banished.
    if (meetingHomes.size) stopMeeting(!walker.anchor.userData.visitorId)
    setVisitorHeld(walker, true)
    held = { walker, original: walker.direction.clone(), candidate: walker.direction.clone(), valid: true, lift: 0, overSink: false }
    walker.route = []; walker.meetingTarget = null; walker.settled = false; landingRing.visible = true
    const opened = sinkhole.open(walker.direction)
    root.classList.add('is-holding'); root.dataset.residentInteraction = 'held'; notice.textContent = opened ? '다른 땅에 놓으면 이동 · 싱크홀에 놓으면 영구 방출' : '원하는 땅으로 옮긴 뒤 놓아 주세요.'
    syncControls()
  }
  function animateHeld(walker: Walker, now: number, dt: number) {
    if (!held) return
    if (gesture) {
      const rect = canvas.getBoundingClientRect(); const x = (gesture.x - rect.left) / rect.width; const y = (gesture.y - rect.top) / rect.height
      const dx = x < .12 ? dt * 145 : x > .88 ? -dt * 145 : 0
      const dy = y < .1 ? -dt * 110 : y > .9 ? dt * 110 : 0
      if (dx || dy) {
        orbit(dx, dy); setRay({ clientX: gesture.x, clientY: gesture.y })
        const hit = raycaster.intersectObject(ground)[0]
        updateHeldTarget(hit)
      }
    }
    held.lift = THREE.MathUtils.lerp(held.lift, .45, .18)
    walker.anchor.position.copy(held.candidate).multiplyScalar(terrain(held.candidate).radius + held.lift)
    walker.anchor.quaternion.copy(orientation(held.candidate, walker.heading))
    walker.model.group.rotation.z = Math.sin(now / 85) * .12
    walker.model.group.position.y = Math.sin(now / 110) * .035
    walker.model.limbs.forEach((limb, i) => { limb.rotation.x = Math.sin(now / 60 + i * 1.7) * .9 })
    if (walker.model.head) walker.model.head.rotation.y = Math.sin(now / 150) * .25
    landingRing.position.copy(held.candidate).multiplyScalar(terrain(held.candidate).radius + .045)
    landingRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), held.candidate)
    landingRing.material.color.set(held.valid ? '#f5edb3' : '#ec997f')
    landingRing.visible = !held.overSink
  }
  function updateHeldTarget(hit?: THREE.Intersection) {
    if (!held) return
    if (hit) { held.candidate.copy(world.worldToLocal(hit.point.clone()).normalize()); held.valid = walkable(held.candidate, held.walker) }
    held.overSink = !!hit && sinkhole.contains(held.candidate); sinkhole.hover(held.overSink)
    notice.textContent = held.overSink ? `놓으면 이 ${held.walker.anchor.userData.visitorId ? '우주인' : '주민'}이 영구 방출됩니다.` : '다른 땅에 놓으면 이동 · 싱크홀에 놓으면 영구 방출'
  }
  function finishDeparture(d: Departure) {
    if (departure !== d) return
    const visitorId = d.walker.anchor.userData.visitorId as number | undefined
    const index = walkers.indexOf(d.walker); if (index !== -1) { walkers.splice(index, 1); updateDiagnostics() }
    if (visitorId) { visitors.remove(visitorId); visitorWalkers.delete(visitorId) }
    else { d.walker.anchor.removeFromParent(); d.walker.model.dispose() }
    departure = null; sinkhole.close()
    root.dataset.residentInteraction = 'idle'; notice.textContent = visitorId ? '우주인이 싱크홀로 방출되었어요.' : '주민이 행성을 떠났어요.'; onIntroduction(false); syncControls()
  }
  function banish() {
    if (!held || departure) return
    const d: Departure = { walker: held.walker, original: held.original.clone(), position: held.walker.anchor.position.clone(), startedAt: null, finishImmediately: false }
    departure = d; held = null; landingRing.visible = false; root.classList.remove('is-holding'); root.dataset.residentInteraction = 'banishing'
    notice.textContent = '주민을 행성에서 방출하고 있어요…'; onIntroduction(true); syncControls()
    if (d.walker.anchor.userData.visitorId) { d.startedAt = performance.now(); notice.textContent = '우주인을 싱크홀로 방출하고 있어요…'; return }
    void persistence.remove(d.walker.id).then(removed => {
      if (departure !== d) return
      if (!removed) {
        const w = d.walker; w.direction.copy(d.original); w.anchor.position.copy(d.original).multiplyScalar(terrain(d.original).radius + .012)
        w.model.group.rotation.z = 0; w.model.group.position.y = 0; departure = null; sinkhole.close()
        root.dataset.residentInteraction = 'idle'; notice.textContent = '저장소에서 삭제하지 못해 방출을 취소했어요. 다시 시도해 주세요.'; onIntroduction(false); syncControls(); return
      }
      const index = walkers.indexOf(d.walker); if (index !== -1) walkers.splice(index, 1)
      updateDiagnostics(); d.startedAt = performance.now()
      if (d.finishImmediately) finishDeparture(d)
    })
  }
  function updateDeparture(now: number) {
    const d = departure; if (!d || d.startedAt === null) return
    const t = THREE.MathUtils.clamp((now - d.startedAt) / 1050, 0, 1); const ease = t * t * (3 - 2 * t)
    const destination = sinkhole.center.clone().multiplyScalar(terrain(sinkhole.center).radius - .6)
    d.walker.anchor.position.lerpVectors(d.position, destination, ease)
    d.walker.anchor.quaternion.copy(orientation(sinkhole.center, d.walker.heading)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, t * Math.PI * 2))
    d.walker.anchor.scale.setScalar(d.walker.scale * (1 - ease * .97)); d.walker.model.group.rotation.z = 0
    if (t >= 1) finishDeparture(d)
  }
  function drop(cancelled = false) {
    if (!held) return
    if (!cancelled && held.overSink) { banish(); return }
    const w = held.walker; const destination = cancelled ? held.original : nearestDrop(held.candidate, w) ?? held.original
    w.direction.copy(destination); w.heading.copy(tangent(destination)); w.model.group.rotation.z = 0; w.model.group.position.y = 0
    w.restingUntil = performance.now() + 750; w.decisionAt = performance.now() + 1200
    w.anchor.position.copy(destination).multiplyScalar(terrain(destination).radius + .012); w.anchor.quaternion.copy(orientation(destination, w.heading))
    setVisitorHeld(w, false)
    held = null; sinkhole.close(); landingRing.visible = false; root.classList.remove('is-holding'); root.dataset.residentInteraction = 'idle'; notice.textContent = defaultHint
    void persistence.flush()
    // Releasing or cancelling a visitor drag must not snap returning attendees home.
    if (meetingHomes.size) stopMeeting(!w.anchor.userData.visitorId)
  }
  function finishGesture(cancelled = false) {
    const current = gesture; if (!current) return
    clearTimeout(current.timer)
    if (held) drop(cancelled)
    else if (!cancelled && !current.moved && current.walker) select(current.walker)
    gesture = null
    if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id)
    syncControls()
  }
  function orbit(dx: number, dy: number) {
    if (follow) { follow.yaw -= dx * .009; follow.elevation = THREE.MathUtils.clamp(follow.elevation + dy * .006, .17, 1.3) }
    else {
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
      spherical.theta -= dx * .006; spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * .006, .05, Math.PI - .05)
      camera.position.setFromSpherical(spherical).add(controls.target); camera.lookAt(controls.target)
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (!canInteract() || arrival || departure || event.button !== 0 || gesture || returning) return
    const walker = pickResident(event)
    if (!walker && !follow) return
    event.preventDefault(); event.stopImmediatePropagation()
    gesture = { id: event.pointerId, walker, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false, timer: 0 }
    if (walker && !('species' in walker)) gesture.timer = window.setTimeout(() => { if (gesture && !gesture.moved) grab(walker) }, 420)
    canvas.setPointerCapture(event.pointerId); syncControls()
  }, true)
  canvas.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (held) {
      const rect = canvas.getBoundingClientRect(); const edge = (event.clientX - rect.left) / rect.width
      if (edge < .12 || edge > .88) orbit(edge < .12 ? 4 : -4, 0)
      setRay(event); const hit = raycaster.intersectObject(ground)[0]
      updateHeldTarget(hit)
    } else {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 7) { gesture.moved = true; clearTimeout(gesture.timer) }
      if (gesture.moved) orbit(event.clientX - gesture.x, event.clientY - gesture.y)
    }
    gesture.x = event.clientX; gesture.y = event.clientY
  }, true)
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(name, event => {
    if (gesture?.id !== event.pointerId) return
    if (name === 'pointerup' && held) { setRay(event); updateHeldTarget(raycaster.intersectObject(ground)[0]) }
    event.preventDefault(); event.stopImmediatePropagation(); finishGesture(name !== 'pointerup')
  }, true)
  canvas.addEventListener('wheel', event => {
    if (!follow || !canInteract()) return
    event.preventDefault(); event.stopImmediatePropagation(); follow.distance = THREE.MathUtils.clamp(follow.distance * Math.exp(event.deltaY * .001), 1.8, 5)
  }, { capture: true, passive: false })
  window.addEventListener('blur', () => finishGesture(true))
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && canInteract()) { if (held || gesture) finishGesture(true); else if (editor.active) { editor.close(); previewActions.hidden = false } else leaveFollow() } })
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishGesture(true) })
  function suspend() { finishGesture(true); leaveFollow(true); editor.close(); syncControls() }

  function finishMeetingReturn() {
    for (const [w, home] of meetingHomes) {
      w.direction.copy(home.direction); w.heading.copy(home.heading)
      w.anchor.position.copy(home.position); w.anchor.quaternion.copy(home.rotation)
      w.model.group.position.copy(home.modelPosition); w.model.group.quaternion.copy(home.modelRotation)
      w.route = []; w.meetingTarget = null; w.settled = false
      w.restingUntil = performance.now() + 2500; w.decisionAt = performance.now() + 2800
      const animal = meetingGuests.get(w)
      if (animal) { animal.meetingControlled = false; animal.rest = 2.5 }
      if (home.bubble) { home.bubble.removeFromParent(); home.bubble.geometry.dispose(); home.bubble.material.dispose() }
    }
    meetingHomes.clear(); meetingGuests.clear(); meeting = false; meetingReturning = false
    root.dataset.meeting = 'idle'; root.dataset.meetingArrived = '0'; root.dataset.meetingParticipants = '0'
    meetingButton.textContent = '✧ 주민 회의'; meetingButton.disabled = !canInteract(); notice.textContent = defaultHint
    void persistence.flush()
  }
  function stopMeeting(immediate = false) {
    ++meetingGeneration; meeting = false
    if (immediate || !meetingHomes.size) { finishMeetingReturn(); return }
    if (meetingReturning) return
    meetingReturning = true; root.dataset.meeting = 'returning'
    notice.textContent = '회의를 마쳤어요. 모두 회의 전 자리로 돌아가고 있어요.'
    for (const [w, home] of meetingHomes) {
      w.meetingTarget = home.direction.clone(); w.settled = false; w.routeAt = 0; w.routeDistance = Infinity
      // Retrace the actual walk, including avoidance detours. This also works
      // when the meeting is ended before the outward journey is finished.
      w.route = [...home.trail].reverse().map(p => p.clone())
      if (!w.route.length) w.route.push(home.direction.clone())
    }
  }
  function updateMeetingStatus() {
    const disabled = (!walkers.length && !wildlife.length) || !!arrival || !canInteract() || !!held || !!departure || meetingReturning
    if (meetingButton.disabled !== disabled) meetingButton.disabled = disabled
    if (!meeting && !meetingReturning) return
    const participants = [...meetingHomes.keys()]
    const arrived = participants.filter(w => w.settled).length
    root.dataset.meetingArrived = String(arrived); root.dataset.meetingParticipants = String(participants.length)
    if (meetingReturning) {
      setForestText(meetingButton, `돌아가는 중 · ${arrived}/${participants.length}`)
      if (arrived === participants.length) finishMeetingReturn()
      return
    }
    root.dataset.meeting = arrived === participants.length ? 'gathered' : 'gathering'
    setForestText(notice, arrived === participants.length ? '모두 모였어요! 회의를 마치면 원래 자리로 돌아가요.' : '동물 대표와 주민들이 공터로 모이고 있어요.')
    setForestText(meetingButton, `회의 마치기 · ${arrived}/${participants.length}`)
  }
  meetingButton.onclick = async () => {
    if (!canInteract() || arrival || held || departure || meetingReturning || (!walkers.length && !wildlife.length)) return
    if (meeting) { stopMeeting(); return }
    leaveFollow(true)
    const representatives = new Map<WildlifeAnimal['species'], WildlifeAnimal>()
    for (const animal of wildlife) {
      if (animal.anchor.userData.incapacitated) continue
      const current = representatives.get(animal.species)
      if (!current || animal.direction.distanceTo(meetingCenter) < current.direction.distanceTo(meetingCenter)) representatives.set(animal.species, animal)
    }
    for (const animal of representatives.values()) {
      const guest: Walker = { id: animal.id, name: animal.name, model: { group: animal.model.group, limbs: [], head: null, height: 1, label: animal.name, fingerprint: 0, mappedParts: [], dispose() {} }, anchor: animal.anchor, direction: animal.direction, heading: animal.heading, scale: 1, collision: .42, routeAt: 0, routeDistance: Infinity, route: [], meetingTarget: null, settled: false, speed: 1, turn: 0, decisionAt: 0, restingUntil: 0, phase: animal.phase }
      meetingGuests.set(guest, animal)
    }
    const participants = [...walkers.filter(w => !w.anchor.userData.incapacitated), ...meetingGuests.keys()]
    if (!participants.length) { notice.textContent = '먼저 치료하기를 눌러 친구들을 깨워 주세요.'; return }
    // Fill the center first; additional rings only grow outwards as seats fill up.
    const spacing = Math.max(.18, ...participants.map(w => w.collision * 2 / 5 + .02))
    const slots = meetingSlots(meetingCenter, participants.length, p => terrainFree(p) && p.distanceTo(meetingCenter) < 1, spacing)
    if (slots.length < participants.length) { meetingGuests.clear(); notice.textContent = '공터에 모든 참석자가 모일 자리가 부족해요.'; return }
    for (const w of participants) {
      const home: MeetingHome = { direction: w.direction.clone(), heading: w.heading.clone(), position: w.anchor.position.clone(), rotation: w.anchor.quaternion.clone(), modelPosition: w.model.group.position.clone(), modelRotation: w.model.group.quaternion.clone(), trail: [w.direction.clone()] }
      const animal = meetingGuests.get(w)
      if (animal) {
        animal.meetingControlled = true
        if (['shark', 'goldfish', 'riverfish'].includes(animal.species)) {
          home.bubble = new THREE.Mesh(new THREE.SphereGeometry(.43, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#a2e3f0', transparent: true, opacity: .18, roughness: .1, metalness: .12, depthWrite: false, clearcoat: 1 }))
          home.bubble.name = '수중 동물의 회의 물방울'; w.anchor.add(home.bubble)
        }
      }
      meetingHomes.set(w, home)
      // Hold everyone while the asynchronous route setup is in progress.
      w.meetingTarget = null; w.settled = false
    }
    meeting = true; const generation = ++meetingGeneration; root.dataset.meeting = 'gathering'; root.dataset.meetingRoutes = 'preparing'; root.dataset.meetingSpecies = [...representatives.keys()].join(',')
    notice.textContent = '동물 대표와 주민들이 공터로 모이고 있어요.'
    const normal = meetingCenter.clone().applyQuaternion(world.getWorldQuaternion(new THREE.Quaternion()))
    const meetingDistance = Math.max(18, camera.position.length())
    camera.position.copy(normal).multiplyScalar(meetingDistance); camera.up.copy(UP); controls.target.set(0, 0, 0); camera.lookAt(controls.target)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (generation !== meetingGeneration) return
    navigation ??= createForestNavigation(terrain, trees)
    // Assign nearest available seats first to reduce crossing paths inside the clearing.
    const available = [...slots]
    for (const walker of participants) {
      if (generation !== meetingGeneration) return
      available.sort((a, b) => a.distanceToSquared(walker.direction) - b.distanceToSquared(walker.direction))
      const target = available.shift()!; walker.meetingTarget = target; walker.settled = false; walker.routeAt = 0; walker.routeDistance = Infinity
      walker.route = navigation.route(walker.direction, target)
      if (!walker.route.length) { stopMeeting(); notice.textContent = '길을 찾지 못해 모두 원래 자리로 돌아가고 있어요.'; return }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    if (generation === meetingGeneration) root.dataset.meetingRoutes = 'ready'
  }
  function updateMeetingWalker(w: Walker, now: number, dt: number) {
    const home = meetingHomes.get(w)!
    const animal = meetingGuests.get(w)
    const target = w.meetingTarget!
    if (w.direction.distanceTo(target) < .008) { w.settled = true; w.direction.copy(target); w.route = [] }
    if (meetingReturning && w.settled) {
      w.anchor.position.copy(home.position); w.anchor.quaternion.copy(home.rotation); w.heading.copy(home.heading)
      w.model.group.position.copy(home.modelPosition); w.model.group.quaternion.copy(home.modelRotation)
      return
    }
    if (!w.settled) {
      if (now > w.routeAt) {
        const distance = w.direction.distanceTo(target)
        if (distance > w.routeDistance - .015 && navigation) {
          const occupied = [...walkers, ...meetingGuests.keys()].filter(other => other !== w).map(other => ({ position: other.direction, radius: (w.collision + other.collision) * .45 / terrain(w.direction).radius + .008 }))
          const reroute = navigation.route(w.direction, target, occupied)
          if (reroute.length) w.route = reroute
        }
        w.routeAt = now + 1800; w.routeDistance = distance
      }
      // Look ahead past intermediate graph samples so an occupied sample does not
      // become an artificial destination in a crowd.
      while (w.route.length > 1 && w.direction.distanceTo(w.route[0]) < .035) w.route.shift()
      const waypoint = w.route[0] ?? target
      const heading = waypoint.clone().addScaledVector(w.direction, -waypoint.dot(w.direction)).normalize()
      const radius = terrain(w.direction).radius
      const step = Math.min(.95 * dt / radius, w.direction.distanceTo(waypoint))
      const canStep = (next: THREE.Vector3) => {
        if (trees.some(t => next.distanceToSquared(t) < Math.min(.0049, w.direction.distanceToSquared(t)) - .0000001)) return false
        return ![...walkers, ...meetingGuests.keys()].some(other => {
          if (other === w || held?.walker === other) return false
          const normalClearance = (w.collision + other.collision) * .45 / radius + .008
          // Original wildlife groups can be closer together than meeting seats.
          // Preserve that spacing when approaching their saved home positions.
          const otherHome = meetingHomes.get(other)
          const clearance = meetingReturning && otherHome
            ? Math.min(normalClearance, home.direction.distanceTo(otherHome.direction) * .9)
            : normalClearance
          // Allow separating motion even if two residents started inside the margin.
          return next.distanceTo(other.direction) < Math.min(clearance, w.direction.distanceTo(other.direction)) - .0000001
        })
      }
      let best: THREE.Vector3 | null = null; let bestHeading = heading; let bestScore = -Infinity
      const remaining = w.direction.distanceTo(waypoint)
      for (let i = 0; i < 25; i++) {
        const turn = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 12
        const candidateHeading = heading.clone().applyAxisAngle(w.direction, turn)
        const next = w.direction.clone().addScaledVector(candidateHeading, step).normalize()
        if (!canStep(next)) continue
        const score = remaining - next.distanceTo(waypoint) + candidateHeading.dot(w.heading) * step * .025 - Math.abs(turn) * .000001
        if (score > bestScore) { bestScore = score; best = next; bestHeading = candidateHeading }
      }
      if (best) { w.direction.copy(best); w.heading.lerp(bestHeading, Math.min(1, dt * 9)).normalize() }
      if (!meetingReturning && home.trail[home.trail.length - 1].distanceTo(w.direction) > .025) home.trail.push(w.direction.clone())
      w.heading.addScaledVector(w.direction, -w.heading.dot(w.direction)).normalize(); w.phase += dt * 11
    } else {
      const heading = meetingCenter.clone().addScaledVector(w.direction, -meetingCenter.dot(w.direction))
      if (heading.lengthSq() > .00001) w.heading.lerp(heading.normalize(), Math.min(1, dt * 3)).normalize()
    }
    const sample = terrain(w.direction)
    // A small jump carries the resident over narrow streams on its route.
    const hop = sample.waterDistance < .045 ? .17 + Math.abs(Math.sin(w.phase * .5)) * .14 : 0
    const bubbleLift = home.bubble ? .5 : 0
    w.anchor.position.copy(w.direction).multiplyScalar(Math.max(sample.radius, 5.09) + .012 + (home.bubble ? bubbleLift : hop))
    w.anchor.quaternion.copy(orientation(w.direction, w.heading))
    if (animal) {
      animal.model.animate(now / 1000 + animal.phase, !w.settled)
      w.model.group.position.y = Math.sin(now / 650 + w.phase) * (w.settled ? .01 : .025)
      return
    }
    const gait = w.settled ? Math.sin(now / 700 + w.phase) * .06 : Math.sin(w.phase) * .46
    w.model.limbs.forEach((limb, i) => { limb.rotation.x = gait * [1, -1, -1, 1][i] })
    w.model.group.position.y = w.settled ? Math.sin(now / 700 + w.phase) * .012 : Math.abs(Math.sin(w.phase)) * .03
    w.model.group.rotation.z = w.settled ? Math.sin(now / 1150 + w.phase) * .035 : 0
    if (w.model.head) w.model.head.rotation.y = Math.sin(now / 1100 + w.phase) * .24
  }
  const terrainFree = (direction: THREE.Vector3) => terrain(direction).waterDistance >= .057 && !trees.some(tree => tree.distanceToSquared(direction) < .0049)
  function walkable(direction: THREE.Vector3, self?: Walker) {
    if (sinkhole.active && sinkhole.center.distanceTo(direction) < .145 && held?.walker !== self) return false
    if (terrain(direction).waterDistance < .057) return false
    if (trees.some(tree => tree.distanceToSquared(direction) < .0047)) return false
    return !walkers.some(other => other !== self && other.direction.distanceTo(direction) < (other.collision + (self?.collision ?? .34)) / terrain(direction).radius + .012)
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
    if (departure) throw new Error('주민이 행성을 떠나고 있어요. 잠시 뒤 다시 시도해 주세요.')
    if (arrival) throw new Error('앞서 만든 주민이 입주하고 있어요. 잠시 뒤 다시 시도해 주세요.')
    leaveFollow(true); stopMeeting(true);
    const direction = findHome(); const model = buildResident(photo, analysis)
    const anchor = new THREE.Group(); anchor.add(model.group); scene.add(anchor)
    const heading = tangent(direction).applyAxisAngle(direction, Math.random() * Math.PI * 2)
    const scale = .74 / Math.max(1.5, model.height)
    const collision = Math.max(.28, new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3()).x * scale * .52)
    const name = normalizeResidentName(requestedName) || nextResidentName(walkers.map(w => w.name))
    const walker: Walker = { id: model.group.uuid, name, routeAt: 0, routeDistance: Infinity, route: [], meetingTarget: null, settled: false, collision, model, anchor, direction, heading, speed: .13 + Math.random() * .065, turn: 0, decisionAt: 0, restingUntil: 0, phase: Math.random() * 10, scale }
    // Camera-relative presentation keeps the new character upright after arbitrary globe rotation.
    camera.getWorldQuaternion(quat); anchor.quaternion.copy(quat)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat)
    const viewHeight = 2 * camera.position.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const initialScale = Math.min(viewHeight * .58, viewHeight * camera.aspect * .58) / model.height
    const initialPosition = up.multiplyScalar(-model.height * initialScale * .46).addScaledVector(right, 0)
    anchor.position.copy(initialPosition); anchor.scale.setScalar(initialScale)
    arrival = { walker, startAt: performance.now(), initialPosition: initialPosition.clone(), initialQuaternion: quat.clone(), initialScale, landingAt: null }
    world.visible = false; welcome.hidden = false; welcome.classList.remove('is-landing'); root.classList.add('is-introducing')
    welcome.querySelector('.edition-forest-welcome__name')!.textContent = `${name} · ${model.label}`
    root.dataset.residentName = name; root.dataset.residentKind = String(model.group.userData.kind); root.dataset.residentFingerprint = String(model.fingerprint); root.dataset.mappedParts = model.mappedParts.join(','); root.dataset.residentPhase = 'preview'
    previewActions.hidden = false; syncControls(); onIntroduction(true)
  }
  function updateArrival(now: number) {
    if (!arrival) return
    const a = arrival; const elapsed = (now - a.startAt) / 1000
    if (a.landingAt === null) {
      if (editor.active) return
      a.walker.anchor.quaternion.copy(a.initialQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.sin(elapsed * 1.3) * .23))
      a.walker.anchor.position.copy(a.initialPosition).add(new THREE.Vector3(0, Math.sin(elapsed * 2.4) * .035, 0))
      return
    }
    world.visible = true; welcome.classList.add('is-landing'); root.dataset.residentPhase = 'landing'
    const progress = THREE.MathUtils.clamp((now - a.landingAt) / 2700, 0, 1); const ease = progress * progress * (3 - 2 * progress)
    const destination = world.localToWorld(a.walker.direction.clone().multiplyScalar(terrain(a.walker.direction).radius + .015))
    const destinationRotation = world.getWorldQuaternion(new THREE.Quaternion()).multiply(orientation(a.walker.direction, a.walker.heading))
    const lift = camera.position.clone().normalize().multiplyScalar(Math.sin(progress * Math.PI) * 2)
    a.walker.anchor.position.lerpVectors(a.initialPosition, destination, ease).add(lift)
    a.walker.anchor.quaternion.slerpQuaternions(a.initialQuaternion, destinationRotation, ease)
    a.walker.anchor.scale.setScalar(THREE.MathUtils.lerp(a.initialScale, a.walker.scale, ease))
    if (progress >= 1) {
      world.attach(a.walker.anchor); a.walker.anchor.position.copy(a.walker.direction).multiplyScalar(terrain(a.walker.direction).radius + .015)
      a.walker.anchor.quaternion.copy(orientation(a.walker.direction, a.walker.heading)); a.walker.anchor.scale.setScalar(a.walker.scale)
      a.walker.decisionAt = now + 1600; a.walker.restingUntil = now + 1300; walkers.push(a.walker); void persistence.add(a.walker); arrival = null; editor.clear()
      welcome.hidden = true; root.classList.remove('is-introducing'); root.dataset.residentPhase = 'walking'; updateDiagnostics(); onIntroduction(false); syncControls()
    }
  }
  function update(now: number) {
    const dt = Math.min(.05, Math.max(0, (now - (lastTime || now)) / 1000)); lastTime = now
    persistence.tick()
    sinkhole.update(dt); updateDeparture(now)
    updateArrival(now)
    updateMeetingStatus()
    if (held?.walker.anchor.userData.visitorId) animateHeld(held.walker, now, dt)
    for (const guest of meetingGuests.keys()) if (guest.meetingTarget) updateMeetingWalker(guest, now, dt)
    for (const walker of walkers) {
      if (departure?.walker === walker) continue
      if (held?.walker === walker) { animateHeld(walker, now, dt); continue }
      if (walker.anchor.userData.incapacitated) continue
      if (meetingHomes.has(walker)) { if (walker.meetingTarget) updateMeetingWalker(walker, now, dt); continue }
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
    visitors.update(dt)
    updateFollow(dt); dialogue.update(dt); visitors.updateLabels()
    if (walkers.length) {
      const d = walkers[0].direction; root.dataset.residentPosition = `${d.x.toFixed(5)},${d.y.toFixed(5)},${d.z.toFixed(5)}`
    }
  }
  function stop() {
    void persistence.flush()
    lastTime = 0; suspend(); stopMeeting(true); editor.clear(); previewActions.hidden = true
    if (departure) { if (departure.startedAt !== null) finishDeparture(departure); else departure.finishImmediately = true }
    sinkhole.hide()
    if (arrival) {
      scene.remove(arrival.walker.anchor); arrival.walker.model.dispose(); arrival = null
      world.visible = true; welcome.hidden = true; root.classList.remove('is-introducing'); root.dataset.residentPhase = walkers.length ? 'walking' : 'idle'; onIntroduction(false)
    }
  }
  return { ready: persistence.ready, create, update, stop, suspend, get following() { return !!follow }, get cameraLocked() { return !!follow || !!returning || !!gesture || !!held || !!departure }, get introducing() { return !!arrival || !!departure } }
}
