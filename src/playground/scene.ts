import * as THREE from 'three'
import { RIDES, RIDE_IDS, SLIDE_CLIMB_TIME, playerPose, slidePoint } from './simulation'
import type { Player, World } from './simulation'

const OUTFITS = [0xf28673, 0x71aea4, 0xecc66b, 0x9695d3, 0x6ca8cb, 0xe89db5, 0xd08a5d, 0xa4b76c]

export function createScene(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0xe7f0ed)
  renderer.domElement.setAttribute('aria-label', '그네, 시소, 미끄럼틀과 뺑뺑이가 있는 3D 놀이터')
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xe7f0ed, 48, 100)
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 150)
  const sun = new THREE.DirectionalLight(0xfff4da, 3)
  sun.position.set(-10, 25, 12); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -23, right: 23, top: 23, bottom: -23, near: 1, far: 65 })
  sun.shadow.normalBias = .04
  scene.add(sun, new THREE.HemisphereLight(0xf1fbff, 0x96a57d, 2.6))
  const materials = new Map<number, THREE.MeshStandardMaterial>()
  const geometries = new Set<THREE.BufferGeometry>()
  const textures = new Set<THREE.Texture>()
  const labels = new Set<THREE.SpriteMaterial>()
  const material = (color: number) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .83 }))
    return materials.get(color)!
  }
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
    geometries.add(geometry)
    const object = new THREE.Mesh(geometry, material(color))
    object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true
    parent.add(object); return object
  }
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) =>
    mesh(parent, new THREE.BoxGeometry(w, h, d), color, x, y, z)
  const ball = (parent: THREE.Object3D, r: number, color: number, x = 0, y = 0, z = 0) =>
    mesh(parent, new THREE.SphereGeometry(r, 20, 14), color, x, y, z)
  const cylinder = (parent: THREE.Object3D, r: number, h: number, color: number, x = 0, y = 0, z = 0) =>
    mesh(parent, new THREE.CylinderGeometry(r, r, h, 32), color, x, y, z)
  const bar = (parent: THREE.Object3D, a: number[], b: number[], r: number, color: number) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b)
    const result = cylinder(parent, r, start.distanceTo(end), color)
    result.position.copy(start).add(end).multiplyScalar(.5)
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize())
    return result
  }
  function label(parent: THREE.Object3D, text: string, color = '#3c554c', width = 3) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fffdf2'; ctx.beginPath(); ctx.roundRect(4, 10, 504, 106, 48); ctx.fill()
    ctx.font = 'bold 42px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 66, 465)
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture)
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false }); labels.add(mat)
    const sprite = new THREE.Sprite(mat); sprite.scale.set(width, width / 4, 1); parent.add(sprite)
    return sprite
  }
  cylinder(scene, 19, .9, 0xc8ba91, 0, -.58).scale.z = .82
  cylinder(scene, 18.9, .12, 0xbad3a2, 0, -.08).scale.z = .82
  const pathA = box(scene, 3.1, .04, 25, 0xeee6cb, 0, .015)
  pathA.receiveShadow = true
  box(scene, 28, .04, 2.5, 0xeee6cb, 0, .025)
  cylinder(scene, 3, .06, 0xf4edd8, 0, .03)
  for (const id of RIDE_IDS) {
    const ride = RIDES[id]
    cylinder(scene, id === 'slide' ? 3.8 : 3.4, .08, new THREE.Color(ride.color).getHex(), ride.x, .01, ride.z)
    const sign = label(scene, `${ride.name}  ·  ${ride.seats}명`, '#42554a', 2.8)
    sign.position.set(ride.x, .8, ride.z + (id === 'slide' ? 4 : 3.5))
  }
  // Low painted fence, with an open entrance along the south path.
  for (let x = -14; x <= 14; x += 1.4) {
    for (const z of [-12, 12]) {
      if (z > 0 && Math.abs(x) < 2) continue
      box(scene, .18, .95, .18, 0xfff3cd, x, .45, z)
      ball(scene, .14, 0xfff3cd, x, .98, z)
      if (x < 13 && !(z > 0 && Math.abs(x + .7) < 2)) box(scene, 1.4, .12, .1, 0xfff3cd, x + .7, .65, z)
    }
  }
  for (let z = -12; z <= 12; z += 1.5) for (const x of [-14, 14]) {
    box(scene, .18, .95, .18, 0xfff3cd, x, .45, z)
    if (z < 12) box(scene, .1, .12, 1.5, 0xfff3cd, x, .65, z + .75)
  }
  for (const [x, z, size] of [[-12, -9, 1], [-2, -10, .85], [12, -9, 1.15], [-12, 3, .85], [12, 1, .8], [-12, 10, 1], [12, 10, .9]]) {
    const tree = new THREE.Group(); tree.position.set(x, 0, z); tree.scale.setScalar(size); scene.add(tree)
    cylinder(tree, .24, 2, 0xac805d, 0, 1)
    ball(tree, 1.4, 0x88b589, 0, 2.8).scale.y = 1.2
    ball(tree, .95, 0xa4c889, -.65, 2.65, .4)
    ball(tree, .85, 0x78a885, .7, 3.1, -.2)
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4
      ball(scene, .12, i % 2 ? 0xffe7a2 : 0xf5c0b2, x + Math.cos(angle) * 1.5, .12, z + Math.sin(angle) * 1.5)
    }
  }
  for (const x of [-10, 10]) {
    box(scene, 2.4, .16, .7, 0xcb9c70, x, .65, -.2)
    box(scene, 2.4, .6, .13, 0xd8ad7f, x, 1.1, -.5)
    for (const side of [-.8, .8]) box(scene, .15, .65, .5, 0x697d6c, x + side, .3, -.2)
  }
  // Swing: each seat hangs from a real moving pivot.
  const swing = new THREE.Group(); swing.position.set(RIDES.swing.x, 0, RIDES.swing.z); scene.add(swing)
  for (const x of [-2.3, 2.3]) {
    bar(swing, [x, 0, -1.1], [x, 3.4, 0], .11, 0xffedd3)
    bar(swing, [x, 0, 1.1], [x, 3.4, 0], .11, 0xffedd3)
  }
  bar(swing, [-2.5, 3.4, 0], [2.5, 3.4, 0], .14, 0xd78068)
  const swingPivots = [-1, 1].map(x => {
    const pivot = new THREE.Group(); pivot.position.set(x, 3.4, 0); swing.add(pivot)
    for (const side of [-.4, .4]) bar(pivot, [side, 0, 0], [side, -2.45, 0], .027, 0x667777)
    box(pivot, .98, .12, .65, 0x775b54, 0, -2.45)
    return pivot
  })
  const seesaw = new THREE.Group(); seesaw.position.set(RIDES.seesaw.x, 1.2, RIDES.seesaw.z); scene.add(seesaw)
  mesh(scene, new THREE.ConeGeometry(.65, 1.2, 3), 0x7b79b2, RIDES.seesaw.x, .6, RIDES.seesaw.z).rotation.y = Math.PI / 2
  box(seesaw, 5.1, .2, .65, 0xf2e7b9)
  for (const side of [-1, 1]) {
    box(seesaw, .9, .13, .8, side < 0 ? 0xb195cf : 0xe6a0a7, side * 2.1, .13)
    bar(seesaw, [side * 1.55, .2, 0], [side * 1.55, .7, 0], .06, 0x696582)
    bar(seesaw, [side * 1.55, .7, -.3], [side * 1.55, .7, .3], .06, 0x696582)
  }
  const slide = new THREE.Group(); slide.position.set(RIDES.slide.x, 0, RIDES.slide.z); scene.add(slide)
  for (const x of [-.75, .75]) for (const z of [-1.8, -.8]) cylinder(slide, .09, 2.9, 0xd49c61, x, 1.45, z)
  box(slide, 1.7, .18, 1.3, 0xffefd1, 0, 2.8, -1.3)
  mesh(slide, new THREE.ConeGeometry(1.5, .9, 4), 0xe5b951, 0, 5.05, -1.3).rotation.y = Math.PI / 4
  for (const x of [-.75, .75]) cylinder(slide, .06, 1.8, 0xd49c61, x, 3.7, -1.8)
  for (let i = 0; i < 9; i++) box(slide, 1.15, .11, .2, 0xfff2cb, 0, .2 + i * .3, -1.9)
  // Winding surface and raised rails share the rider's exact centerline.
  const chutePositions: number[] = [], chuteIndices: number[] = [], rails: THREE.Vector3[][] = [[], []]
  for (let i = 0; i <= 160; i++) {
    const point = slidePoint(i / 160), sideX = Math.cos(point.yaw), sideZ = -Math.sin(point.yaw)
    for (let side = 0; side < 2; side++) {
      const offset = side ? .7 : -.7
      const x = point.x + sideX * offset, z = point.z + sideZ * offset
      chutePositions.push(x, point.y, z)
      rails[side].push(new THREE.Vector3(x, point.y + .22, z))
    }
    if (i < 160) { const n = i * 2; chuteIndices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3) }
  }
  const chute = new THREE.BufferGeometry()
  chute.setAttribute('position', new THREE.Float32BufferAttribute(chutePositions, 3)); chute.setIndex(chuteIndices); chute.computeVertexNormals()
  mesh(slide, chute, 0xf5d573)
  for (const rail of rails) mesh(slide, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 160, .085, 8, false), 0xe7ae4c)
  const spinner = new THREE.Group(); spinner.position.set(RIDES.spinner.x, 0, RIDES.spinner.z); scene.add(spinner)
  cylinder(spinner, 2.3, .28, 0x56a99f, 0, .24)
  cylinder(spinner, .16, 1.25, 0xfff2ca, 0, .9)
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, x = Math.sin(a), z = Math.cos(a)
    bar(spinner, [x * .25, .4, z * .25], [x * 2.2, .4, z * 2.2], .025, 0xc7e4c2)
    bar(spinner, [x * .8, .4, z * .8], [x * .8, 1.25, z * .8], .055, 0xffefca)
    bar(spinner, [0, 1.25, 0], [x * .8, 1.25, z * .8], .055, 0xffefca)
  }
  const title = label(scene, '우리 동네 놀이터', '#657b58', 4.8); title.position.set(0, 1.7, -11)
  const avatars = new Map<string, { group: THREE.Group; body: THREE.Group; limbs: THREE.Group[]; name: THREE.Sprite; outfit: number }>()
  function avatar(player: Player, self: boolean) {
    const group = new THREE.Group(), body = new THREE.Group(); group.add(body); scene.add(group)
    const seed = player.outfit, color = OUTFITS[seed % OUTFITS.length]
    const skin = [0xffdbb7, 0xeab58f, 0xbe896a, 0xf5cfa5][Math.floor(seed / 8) % 4]
    const hair = [0x604137, 0xa36f48, 0x3e3c43, 0xc29158][Math.floor(seed / 32) % 4]
    const style = Math.floor(seed / 128) % 3
    const torso = cylinder(body, .28, .48, color, 0, .64); torso.scale.z = .8
    if (style === 0) {
      for (let i = 0; i < 3; i++) box(body, .49, .045, .02, 0xfff5df, 0, .5 + i * .12, .23)
    } else if (style === 1) {
      box(body, .34, .28, .035, 0x516a86, 0, .54, .23)
      for (const x of [-.12, .12]) { box(body, .065, .39, .03, 0x516a86, x, .68, .23); ball(body, .025, 0xf8d980, x, .67, .26) }
    } else {
      ball(body, .1, 0xfff2ce, 0, .65, .23).scale.z = .2
      box(body, .23, .09, .025, 0xfff2ce, 0, .47, .23)
    }
    ball(body, .49, skin, 0, 1.23).scale.z = .88
    const hairCap = mesh(body, new THREE.SphereGeometry(.505, 20, 12, 0, Math.PI * 2, 0, Math.PI * .46), hair, 0, 1.24)
    hairCap.scale.z = .9
    for (const x of [-.46, .46]) ball(body, .1, skin, x, 1.2)
    for (const x of [-.17, .17]) {
      ball(body, .047, 0x352f32, x, 1.23, .409).scale.y = 1.15
      ball(body, .013, 0xffffff, x - .012, 1.248, .451)
      ball(body, .065, 0xf0a19a, x * 1.55, 1.08, .36).scale.z = .2
    }
    const smile = mesh(body, new THREE.TorusGeometry(.069, .012, 6, 12, Math.PI), 0x945f57, 0, 1.095, .429)
    smile.rotation.z = Math.PI
    if (seed % 3 === 0) {
      cylinder(body, .43, .12, color, 0, 1.68)
      ball(body, .33, color, 0, 1.71).scale.y = .45
      ball(body, .075, 0xffe5ac, 0, 1.9)
    } else if (seed % 3 === 1) {
      for (const x of [-.35, .35]) ball(body, .16, hair, x, 1.6, -.1)
    }
    const limbs: THREE.Group[] = []
    for (const side of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * .14, .4, 0); body.add(leg)
      cylinder(leg, .105, .25, style === 1 ? 0x516a86 : 0x746f81, 0, -.12)
      ball(leg, .13, 0xfff8e7, 0, -.28, .055).scale.set(.95, .6, 1.45)
      limbs.push(leg)
      const arm = new THREE.Group(); arm.position.set(side * .3, .8, 0); body.add(arm)
      cylinder(arm, .09, .23, color, side * .045, -.08)
      ball(arm, .095, skin, side * .06, -.22)
      limbs.push(arm)
    }
    const name = label(group, `${self ? '나 · ' : ''}${player.nickname}`, self ? '#267b66' : '#4d5859', 2)
    name.position.y = 2.2
    if (self) {
      const ring = mesh(group, new THREE.RingGeometry(.48, .58, 40), 0xfff9cf, 0, .035)
      ring.rotation.x = -Math.PI / 2
    }
    const result = { group, body, limbs, name, outfit: seed }; avatars.set(player.id, result); return result
  }
  function removeAvatar(id: string) {
    const item = avatars.get(id); if (!item) return
    item.group.traverse(object => {
      if (object instanceof THREE.Mesh) { object.geometry.dispose(); geometries.delete(object.geometry) }
    })
    const mat = item.name.material as THREE.SpriteMaterial
    if (mat.map) { mat.map.dispose(); textures.delete(mat.map) }
    mat.dispose(); labels.delete(mat)
    scene.remove(item.group); avatars.delete(id)
  }
  const focus = new THREE.Vector3(), target = new THREE.Vector3()
  let aspect = 1, height = 1, overview = true, cameraHeight = 30
  const resize = () => {
    const bounds = container.getBoundingClientRect(); height = Math.max(1, bounds.height); aspect = Math.max(1, bounds.width) / height
    renderer.setSize(Math.max(1, bounds.width), height, false)
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize()
  function render(world: World, selfId: string, dt: number) {
    for (const id of avatars.keys()) if (!world.players[id]) removeAvatar(id)
    for (const player of Object.values(world.players)) {
      const item = avatars.get(player.id) ?? avatar(player, player.id === selfId)
      const pose = playerPose(world, player), riding = Boolean(player.riding)
      const mix = 1 - Math.exp(-dt * 16)
      target.set(pose.x, pose.y + (player.moving ? Math.abs(Math.sin(world.time * 12)) * .07 : 0), pose.z)
      if (riding || item.group.position.lengthSq() === 0) item.group.position.copy(target)
      else item.group.position.lerp(target, mix)
      let angle = pose.yaw - item.body.rotation.y
      angle = Math.atan2(Math.sin(angle), Math.cos(angle))
      if (riding) item.body.rotation.y = pose.yaw
      else item.body.rotation.y += angle * mix
      item.body.rotation.x = pose.tilt
      const sitting = riding && (player.riding!.id !== 'slide' || world.time - player.riding!.since >= SLIDE_CLIMB_TIME)
      item.body.position.y = sitting ? -.32 : 0
      item.limbs.forEach((limb, i) => {
        const kick = player.pumpResult === 'hit' ? Math.max(0, 1 - (world.time - player.pumpAt) / .3) : 0
        limb.rotation.x = sitting ? (i % 2 === 0 ? -1.05 - kick * .8 : -.7) : player.moving || riding ? Math.sin(world.time * 12 + (i < 2 ? 0 : Math.PI)) * .45 * (i % 2 ? -1 : 1) : 0
      })
    }
    for (let i = 0; i < 2; i++) swingPivots[i].rotation.x = world.swings[i].angle
    seesaw.rotation.z = world.seesawAngle; spinner.rotation.y = world.spinAngle
    const self = world.players[selfId], pose = self && playerPose(world, self)
    const desired = overview || !pose ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(pose.x, .5, pose.z)
    focus.lerp(desired, 1 - Math.exp(-dt * 4))
    const viewHeight = overview || !self ? Math.max(27, 33 / aspect) : aspect < 1 ? 23 : 17
    cameraHeight += (viewHeight - cameraHeight) * (1 - Math.exp(-dt * 5))
    camera.left = -cameraHeight * aspect / 2; camera.right = -camera.left
    camera.top = cameraHeight / 2; camera.bottom = -camera.top; camera.updateProjectionMatrix()
    camera.position.copy(focus).add(new THREE.Vector3(0, 22, 24)); camera.lookAt(focus)
    renderer.render(scene, camera)
  }
  const projection = new THREE.Vector3()
  return { canvas: renderer.domElement, render, setOverview: (value: boolean) => { overview = value },
    projectRide(id: keyof typeof RIDES) {
      const ride = RIDES[id]
      projection.set(ride.x, 1.9, ride.z + .5).project(camera)
      return { x: (projection.x + 1) * aspect * height / 2, y: (1 - projection.y) * height / 2,
        visible: projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < .9 && Math.abs(projection.y) < .85 }
    },
    dispose() {
      observer.disconnect()
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
      textures.forEach(t => t.dispose()); labels.forEach(m => m.dispose())
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    } }
}
