import * as THREE from 'three'
import type { ResidentModel } from './edition-forest-resident-model'
import { warpSurfaceUV } from './edition-forest-extension-math'

export function createForestTextureEditor(root: HTMLElement, canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, onDone: () => void) {
  const panel = document.createElement('div'); panel.className = 'edition-forest-texture-editor'; panel.hidden = true
  panel.innerHTML = `<div><span>PLANET DRESSING ROOM ✦</span><strong>행성 친구의 모습을 다듬어요.</strong><p>얼굴이나 옷을 드래그하면 주변까지 부드럽게 늘어나요.</p></div>
    <div class="edition-forest-texture-editor__tools"><button type="button" data-tool="warp" aria-pressed="true">텍스처 밀기</button><button type="button" data-tool="rotate" aria-pressed="false">모델 돌리기</button><label>브러시 <input type="range" min="25" max="140" value="85" aria-label="텍스처 브러시 크기"></label><button type="button" data-tool="undo" disabled>되돌리기</button><button type="button" data-tool="reset">처음으로</button><button type="button" data-tool="done">수정 완료</button></div>`
  root.append(panel)
  const brush = document.createElement('div'); brush.className = 'edition-forest-texture-brush'; brush.hidden = true; root.append(brush)
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2()
  let active = false; let rotate = false; let model: ResidentModel | null = null; let anchor: THREE.Group | null = null
  const original = new Map<THREE.BufferGeometry, Float32Array>()
  const history: Map<THREE.BufferGeometry, Float32Array>[] = []
  let stroke: { pointerId: number; x: number; y: number; mesh: THREE.Mesh | null; uv: THREE.Vector2 | null; before: Map<THREE.BufferGeometry, Float32Array> } | null = null
  const q = (name: string) => panel.querySelector<HTMLButtonElement>(`[data-tool="${name}"]`)!
  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
    camera.updateMatrixWorld(); anchor?.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera)
    return model ? raycaster.intersectObject(model.group, true).find(hit => hit.object instanceof THREE.Mesh && hit.uv && hit.face) : undefined
  }
  function baseUV(hit: THREE.Intersection) {
    const mesh = hit.object as THREE.Mesh; const position = mesh.geometry.getAttribute('position'); const uv = original.get(mesh.geometry)!; const face = hit.face!
    const local = mesh.worldToLocal(hit.point.clone())
    const bary = new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(position, face.a), new THREE.Vector3().fromBufferAttribute(position, face.b), new THREE.Vector3().fromBufferAttribute(position, face.c)).getBarycoord(local, new THREE.Vector3())!
    return new THREE.Vector2(uv[face.a * 2] * bary.x + uv[face.b * 2] * bary.y + uv[face.c * 2] * bary.z, uv[face.a * 2 + 1] * bary.x + uv[face.b * 2 + 1] * bary.y + uv[face.c * 2 + 1] * bary.z)
  }
  function finishStroke() {
    if (stroke?.before.size) { history.push(stroke.before); if (history.length > 20) history.shift(); q('undo').disabled = false; root.dataset.textureEdits = String(Number(root.dataset.textureEdits ?? 0) + 1) }
    if (stroke && canvas.hasPointerCapture(stroke.pointerId)) canvas.releasePointerCapture(stroke.pointerId)
    stroke = null
  }
  canvas.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return
    event.preventDefault(); event.stopImmediatePropagation()
    const hit = pick(event)
    if (!rotate && !hit) return
    stroke = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, mesh: hit?.object as THREE.Mesh ?? null, uv: hit ? baseUV(hit) : null, before: new Map() }
    canvas.setPointerCapture(event.pointerId)
  }, true)
  canvas.addEventListener('pointermove', event => {
    if (!active) return
    event.preventDefault(); event.stopImmediatePropagation()
    const hit = pick(event); brush.hidden = rotate || !hit
    if (hit) {
      const rect = root.getBoundingClientRect(); brush.style.left = `${event.clientX - rect.left}px`; brush.style.top = `${event.clientY - rect.top}px`
      const geometry = (hit.object as THREE.Mesh).geometry; geometry.computeBoundingSphere()
      const radius = geometry.boundingSphere!.radius * Number(panel.querySelector('input')!.value) / 100
      const worldRadius = radius * hit.object.getWorldScale(new THREE.Vector3()).x
      const pixels = worldRadius / camera.position.distanceTo(hit.point) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * canvas.clientHeight
      brush.style.width = brush.style.height = `${pixels}px`
    }
    if (!stroke || stroke.pointerId !== event.pointerId) return
    if (rotate && anchor) {
      const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion())
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRotation); const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRotation)
      anchor.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, (event.clientX - stroke.x) * .009)).premultiply(new THREE.Quaternion().setFromAxisAngle(right, (event.clientY - stroke.y) * .009))
    } else if (hit && hit.object === stroke.mesh && stroke.uv) {
      const mesh = hit.object as THREE.Mesh; const geometry = mesh.geometry; const uv = geometry.getAttribute('uv'); const nextUV = baseUV(hit)
      const delta = nextUV.clone().sub(stroke.uv); delta.clampLength(0, .065)
      if (delta.lengthSq() > .0000001) {
        if (!stroke.before.has(geometry)) stroke.before.set(geometry, new Float32Array(uv.array))
        geometry.computeBoundingSphere()
        const center = mesh.worldToLocal(hit.point.clone()); const radius = geometry.boundingSphere!.radius * Number(panel.querySelector('input')!.value) / 100
        warpSurfaceUV(geometry.getAttribute('position').array, geometry.getAttribute('normal').array, uv.array as Float32Array, center, hit.face!.normal, delta, radius)
        uv.needsUpdate = true
      }
      stroke.uv.copy(nextUV)
    } else { stroke.mesh = hit?.object as THREE.Mesh ?? null; stroke.uv = hit ? baseUV(hit) : null }
    stroke.x = event.clientX; stroke.y = event.clientY
  }, true)
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(name, event => {
    if (active && stroke?.pointerId === event.pointerId) { event.stopImmediatePropagation(); finishStroke() }
  }, true)
  canvas.addEventListener('pointerleave', () => { brush.hidden = true })
  q('warp').onclick = () => setRotate(false); q('rotate').onclick = () => setRotate(true)
  function setRotate(value: boolean) { finishStroke(); rotate = value; q('warp').setAttribute('aria-pressed', String(!value)); q('rotate').setAttribute('aria-pressed', String(value)); brush.hidden = true; canvas.style.cursor = value ? 'grab' : 'crosshair' }
  const restore = (snapshot: Map<THREE.BufferGeometry, Float32Array>) => snapshot.forEach((data, geometry) => { const uv = geometry.getAttribute('uv'); (uv.array as Float32Array).set(data); uv.needsUpdate = true })
  q('undo').onclick = () => { finishStroke(); const previous = history.pop(); if (previous) restore(previous); q('undo').disabled = !history.length }
  q('reset').onclick = () => { finishStroke(); history.push(new Map([...original.keys()].map(g => [g, new Float32Array(g.getAttribute('uv').array)]))); restore(original); q('undo').disabled = false }
  q('done').onclick = () => { close(); onDone() }
  function close() { finishStroke(); active = false; panel.hidden = true; brush.hidden = true; root.classList.remove('is-texture-editing'); canvas.style.cursor = '' }
  return {
    open(nextModel: ResidentModel, nextAnchor: THREE.Group) {
      if (model !== nextModel) {
        original.clear(); history.length = 0; q('undo').disabled = true; model = nextModel; anchor = nextAnchor
        const clones: THREE.BufferGeometry[] = []
        model.group.traverse(object => {
          if (!(object instanceof THREE.Mesh) || !object.geometry.getAttribute('uv')) return
          object.geometry = object.geometry.clone(); clones.push(object.geometry); original.set(object.geometry, new Float32Array(object.geometry.getAttribute('uv').array))
        })
        const dispose = model.dispose; model.dispose = () => { clones.forEach(g => g.dispose()); dispose() }
      }
      active = true; panel.hidden = false; root.classList.add('is-texture-editing'); setRotate(false)
    },
    close,
    clear() { close(); model = null; anchor = null; original.clear(); history.length = 0 },
    get active() { return active },
  }
}
