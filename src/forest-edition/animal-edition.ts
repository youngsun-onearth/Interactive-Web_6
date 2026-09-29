import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './animal-edition.css'
import { createWildlife } from './wildlife'
import { createSpaceEnvironment } from './space-environment'
import './space-theme.css'
import { createMoveIn } from './edition-forest-move-in'
import { createResidents } from './edition-forest-residents'
import { createExtendedResidents } from './edition-forest-residents-extended'
import { accelerateForestGround, indexForestPoints } from '../forest-performance'
import { createEditionMusic } from './background-music'

const UP = new THREE.Vector3(0, 1, 0)
const TAU = Math.PI * 2
const RADIUS = 5
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)
const spherical = (longitude: number, latitude: number) => new THREE.Vector3(Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude))
let seed = 130713
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
const range = (a: number, b: number) => a + random() * (b - a)
function field(p: THREE.Vector3, scale = 1) {
  return (Math.sin(p.x * 3.7 * scale + p.z * 2.9 * scale) + Math.sin(p.y * 4.3 * scale - p.x * 1.8 * scale + 1.2) + Math.cos(p.z * 5.1 * scale + p.y * 2.1 * scale)) / 3
}
function route(points: number[][]) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => spherical(x, y)), false, 'catmullrom', .35)
  return curve.getPoints(points.length * 20).map(p => p.normalize())
}
// These are individually authored spherical routes, not copies of one terrain tile.
const rivers = [
  route([[-.80, 1.25], [-.55, .85], [-.20, .62], [-.40, .32], [.03, .12], [.12, -.20], [.57, -.40], [.69, -.89], [1.10, -1.32]]),
  route([[1.8, 1.1], [1.28, .80], [.82, .75], [.45, .42], [.03, .12]]),
  route([[-2.8, .9], [-2.5, .48], [-2.7, .1], [-2.1, -.17], [-1.78, -.65], [-1.2, -1.1]]),
  route([[2.9, -.8], [2.6, -.42], [2.1, -.3], [1.95, .04], [2.2, .4], [1.8, 1.1]]),
]
const lakes = [{ p: spherical(-.9, -.38), size: .13 }, { p: spherical(1.25, -.47), size: .16 }, { p: spherical(-2.2, .77), size: .115 }]
const paths = [route([[-1.0, .48], [-.76, .25], [-.62, -.12], [-.40, -.52], [-.2, -.88]]), route([[.35, .9], [.6, .53], [.77, .06], [1.0, -.08], [1.5, .20], [1.75, .57]]), route([[-2.9, -.7], [-2.3, -.55], [-1.9, -.1], [-1.7, .32]])]
const riverPoints = rivers.flat()
const pathPoints = paths.flat()
const riverIndex = indexForestPoints(riverPoints), pathIndex = indexForestPoints(pathPoints)
function nearest(p: THREE.Vector3, points: THREE.Vector3[]) {
  if (points === riverPoints) return riverIndex.distance(p)
  if (points === pathPoints) return pathIndex.distance(p)
  let result = 100
  for (const q of points) result = Math.min(result, p.distanceToSquared(q))
  return Math.sqrt(result)
}
function terrain(p: THREE.Vector3) {
  let waterDistance = nearest(p, riverPoints) - (.024 + (field(p, 2) + 1) * .009)
  for (const lake of lakes) waterDistance = Math.min(waterDistance, p.distanceTo(lake.p) - lake.size)
  const bank = smooth(-.004, .038, waterDistance)
  const hill = .13 + .22 * smooth(-.7, .8, field(p)) + .07 * field(p, 3)
  return { radius: RADIUS - .38 + bank * (.56 + hill), waterDistance, bank }
}

function leafGeometry() {
  const positions: number[] = []; const indices: number[] = []; const colors: number[] = []
  for (let i = 0; i <= 5; i++) {
    const t = i / 5; const width = Math.sin(Math.PI * t) * .43
    for (let side = -1; side <= 1; side++) {
      positions.push(side * width, t, Math.sin(t * Math.PI) * .18 - Math.abs(side) * .10)
      const color = new THREE.Color().setRGB(.78 + t * .2, .84 + t * .15, .69 + t * .2)
      colors.push(color.r, color.g, color.b)
    }
    if (i < 5) for (let j = 0; j < 2; j++) { const a = i * 3 + j; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry
}

function barkTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#c39258'; ctx.fillRect(0, 0, 128, 256)
  for (let i = 0; i < 650; i++) {
    ctx.strokeStyle = `rgba(${random() > .5 ? '92,58,27' : '246,209,134'},${range(.03, .18)})`
    const x = random() * 128; const y = random() * 256
    ctx.lineWidth = range(.5, 3); ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - 4, y + 10, x + 4, y + 25, x, y + range(30, 80)); ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture
}

export function createAnimalForest(root: HTMLElement, { extended = true }: { extended?: boolean } = {}) {
  root.classList.add('space-edition')
  seed = 130713
  const meetingCenter = spherical(.55, .1)
  if (extended) {
    let best = -Infinity
    const front = spherical(.25, .15)
    for (let i = 0; i < 1600; i++) {
      const y = 1 - (i + .5) / 1600 * 2; const angle = i * 2.399963
      const point = new THREE.Vector3(Math.sqrt(1 - y * y) * Math.cos(angle), y, Math.sqrt(1 - y * y) * Math.sin(angle))
      const score = Math.min(.55, terrain(point).waterDistance) * 2 - point.distanceTo(front) * .12
      if (score > best) { best = score; meetingCenter.copy(point) }
    }
  }
  const clearingRadius = Math.min(.46, terrain(meetingCenter).waterDistance - .05)
  const inClearing = (p: THREE.Vector3, margin = 0) => extended && p.distanceTo(meetingCenter) < clearingRadius + margin
  root.innerHTML = `
    <div class="animal-edition__viewport" aria-label="드래그로 회전하고 휠로 확대하는 동물들의 작은 행성"></div>
    <header class="animal-edition__title"><span class="animal-edition__eyebrow">HELLO, LITTLE UNIVERSE ✦</span><h2>동물의 숲<span class="animal-edition__subtitle">우주 에디션</span></h2><p>별빛 사이, 우리만의 작은 행성.<br>오늘은 누구와 우주 산책을 할까요?</p></header>
    <div class="animal-edition__stamp"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="10" fill="currentColor"/><ellipse cx="20" cy="20" rx="19" ry="6" transform="rotate(-28 20 20)" stroke="#dfcaff" stroke-width="2"/><circle cx="32" cy="7" r="2" fill="#ffe5a2"/></svg><span>LITTLE PLANET<br>NO. 015</span></div>
    <div class="animal-edition__footer"><span class="animal-edition__live"><i></i>오늘도, 행성은 반짝이는 중</span><p><span>드래그</span> 행성 돌리기 <b>·</b> <span>휠</span> 가까이 보기</p></div>
    <div class="animal-edition__loading" role="status">별빛 사이에 작은 행성을 만들고 있어요…</div>`
  const viewport = root.querySelector<HTMLElement>('.animal-edition__viewport')!
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 250)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.24
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
  viewport.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.dampingFactor = .065; controls.enablePan = false
  controls.rotateSpeed = .65; controls.zoomSpeed = .85; controls.minDistance = 7.7; controls.maxDistance = 38
  controls.minPolarAngle = .02; controls.maxPolarAngle = Math.PI - .02
  const world = new THREE.Group(); scene.add(world)
  world.rotation.set(.04, -.14, -.12)
  scene.add(new THREE.HemisphereLight('#e4f3ff', '#66826c', 2.15))
  scene.add(new THREE.AmbientLight('#e3f3ea', .45))
  const sun = new THREE.DirectionalLight('#edf8ff', 3.1); sun.position.set(-8, 11, 12); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8
  sun.shadow.normalBias = .035; sun.shadow.bias = -.0002; sun.shadow.camera.far = 40; scene.add(sun)
  const fill = new THREE.DirectionalLight('#b5d6e7', 1.15); fill.position.set(8, 2, -6); scene.add(fill)
  const groundGeometry = new THREE.SphereGeometry(RADIUS, 256, 160)
  const position = groundGeometry.getAttribute('position'); const groundColors = []
  const grassA = new THREE.Color('#437652'); const grassB = new THREE.Color('#83a978'); const earth = new THREE.Color('#8d8b78'); const sand = new THREE.Color('#dddccb')
  const p = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize(); const sample = terrain(p)
    const meadow = smooth(-.65, .7, field(p, 2))
    const color = grassA.clone().lerp(grassB, meadow * .8)
    if (sample.bank < .88) color.copy(earth).lerp(sand, smooth(.05, .88, sample.bank) * .6)
    if (inClearing(p)) color.lerp(new THREE.Color('#91ac7d'), .3)
    color.multiplyScalar(.95 + random() * .1)
    groundColors.push(color.r, color.g, color.b); p.multiplyScalar(sample.radius); position.setXYZ(i, p.x, p.y, p.z)
  }
  groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3)); groundGeometry.computeVertexNormals()
  const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  const sinkCenter = { value: new THREE.Vector3(0, 0, 1) }; const sinkAmount = { value: 0 }
  groundMaterial.onBeforeCompile = shader => {
    if (extended) { shader.uniforms.forestSinkCenter = sinkCenter; shader.uniforms.forestSinkAmount = sinkAmount }
    shader.vertexShader = 'varying vec3 forestPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nforestPosition = position;')
    shader.fragmentShader = 'varying vec3 forestPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cell = floor(forestPosition * 105.0);
      float grain = fract(sin(dot(cell, vec3(12.9898, 78.233, 36.41))) * 43758.5453);
      diffuseColor.rgb *= .93 + grain * .14;`)
    if (extended) {
      shader.vertexShader = 'uniform vec3 forestSinkCenter;\nuniform float forestSinkAmount;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float sinkDistance = length(normalize(position) - forestSinkCenter) * 5.4;
        transformed -= normalize(position) * (1.0 - smoothstep(.13 * max(forestSinkAmount, .001), .63 * max(forestSinkAmount, .001), sinkDistance)) * .84 * forestSinkAmount;`)
      shader.fragmentShader = 'uniform vec3 forestSinkCenter;\nuniform float forestSinkAmount;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float sinkShade = (1.0 - smoothstep(.15 * max(forestSinkAmount, .001), .61 * max(forestSinkAmount, .001), length(normalize(forestPosition) - forestSinkCenter) * 5.4)) * forestSinkAmount;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.12, .075, .045), sinkShade);`)
    }
  }
  const ground = new THREE.Mesh(groundGeometry, groundMaterial); ground.castShadow = true; ground.receiveShadow = true; world.add(ground)
  accelerateForestGround(ground)
  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#19a4d0', roughness: .23, metalness: .16, transparent: true, opacity: .73, depthWrite: false })
  let waterShader: { uniforms: Record<string, { value: unknown }> } | undefined
  waterMaterial.onBeforeCompile = shader => {
    waterShader = shader; shader.uniforms.forestTime = { value: 0 }
    shader.vertexShader = 'varying vec3 waterPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwaterPosition = position;')
    shader.fragmentShader = 'varying vec3 waterPosition;\nuniform float forestTime;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float wave = sin(waterPosition.x * 30. + waterPosition.z * 19. + sin(waterPosition.y * 24.) + forestTime * .8);
      diffuseColor.rgb += smoothstep(.91, 1., wave) * .105;`)
    if (extended) {
      shader.uniforms.forestSinkCenter = sinkCenter; shader.uniforms.forestSinkAmount = sinkAmount
      shader.fragmentShader = 'uniform vec3 forestSinkCenter;\nuniform float forestSinkAmount;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (forestSinkAmount > .005 && length(normalize(waterPosition) - forestSinkCenter) * 5.4 < .60 * forestSinkAmount) discard;`)
    }
  }
  const water = new THREE.Mesh(new THREE.SphereGeometry(5.045, 160, 100), waterMaterial); water.receiveShadow = true; world.add(water)

  // Shared instanced geometry keeps thousands of individual leaves and flowers inexpensive.
  type Batch = { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; colors: THREE.Color[]; shadow: boolean }
  const batches = new Map<string, Batch>()
  const plain = new THREE.MeshStandardMaterial({ roughness: .88 })
  const leaves = new THREE.MeshStandardMaterial({ roughness: .92, side: THREE.DoubleSide, vertexColors: true })
  const trunkMaterial = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1 })
  const followFocus = { value: new THREE.Vector3() }; const followVisibility = { value: 0 }
  if (extended) for (const material of [plain, leaves, trunkMaterial]) {
    material.alphaToCoverage = renderer.getContext().getContextAttributes()?.antialias ?? false
    // Foliage between the camera and the tracked resident yields softly, so a
    // nearby canopy cannot completely hide the character in the close view.
    material.onBeforeCompile = shader => {
      shader.uniforms.forestFollowFocus = followFocus; shader.uniforms.forestFollowVisibility = followVisibility
      shader.uniforms.forestSinkCenter = sinkCenter; shader.uniforms.forestSinkAmount = sinkAmount
      shader.vertexShader = 'varying vec3 forestOccluderPosition;\nvarying vec3 forestDecorPosition;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 forestInstancePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          forestInstancePosition = instanceMatrix * forestInstancePosition;
        #endif
        forestDecorPosition = forestInstancePosition.xyz;
        forestOccluderPosition = (modelMatrix * forestInstancePosition).xyz;`)
      shader.fragmentShader = 'varying vec3 forestOccluderPosition;\nvarying vec3 forestDecorPosition;\nuniform vec3 forestFollowFocus;\nuniform float forestFollowVisibility;\nuniform vec3 forestSinkCenter;\nuniform float forestSinkAmount;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (forestSinkAmount > .005 && length(normalize(forestDecorPosition) - forestSinkCenter) * 5.4 < .59 * forestSinkAmount) discard;
        if (forestFollowVisibility > .001) {
          vec3 sight = forestFollowFocus - cameraPosition;
          float t = dot(forestOccluderPosition - cameraPosition, sight) / max(dot(sight, sight), .001);
          if (t > .01 && t < .99) {
            float distanceToSight = length(forestOccluderPosition - cameraPosition - sight * t);
            float coverage = (1.0 - smoothstep(.58, 1.05, distanceToSight)) * forestFollowVisibility;
            #ifdef ALPHA_TO_COVERAGE
              diffuseColor.a *= 1.0 - coverage;
              if (diffuseColor.a < .001) discard;
            #else
              float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
              if (grain < coverage) discard;
            #endif
          }
        }`)
    }
  }
  const sphere = new THREE.SphereGeometry(1, 9, 7)
  const cylinder = new THREE.CylinderGeometry(.65, 1, 1, 9)
  const leaf = leafGeometry()
  const cone = new THREE.ConeGeometry(1, 1, 11)
  const stone = new THREE.IcosahedronGeometry(1, 1)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const temp = new THREE.Object3D(); const local = new THREE.Object3D()
  function put(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Matrix4, xyz: number[], scale: number[], color: string | THREE.Color, rotation?: THREE.Quaternion, shadow = true) {
    let batch = batches.get(name)
    if (!batch) { batch = { geometry, material, matrices: [], colors: [], shadow }; batches.set(name, batch) }
    local.position.set(xyz[0], xyz[1], xyz[2]); local.scale.set(scale[0], scale[1], scale[2]); local.quaternion.copy(rotation ?? new THREE.Quaternion()); local.updateMatrix()
    batch.matrices.push(parent.clone().multiply(local.matrix)); batch.colors.push(new THREE.Color(color))
  }
  function frame(direction: THREE.Vector3, height?: number) {
    temp.position.copy(direction).multiplyScalar(height ?? terrain(direction).radius)
    temp.quaternion.setFromUnitVectors(UP, direction); temp.rotateY(random() * TAU); temp.scale.setScalar(1); temp.updateMatrix(); return temp.matrix.clone()
  }
  const tilt = (direction: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize())
  const treePlaces: THREE.Vector3[] = []
  function tree(direction: THREE.Vector3, species: number) {
    const f = frame(direction); const size = range(.74, 1.22); const height = size * range(.60, .85)
    const bright = Math.sin(direction.x * 183 + direction.y * 79 + direction.z * 251) > .45
    const canopy = bright ? (species === 1 ? '#6b9c64' : '#89b974') : species === 2 ? '#638b65' : species === 3 ? '#497e62' : species === 1 ? '#285444' : '#39714e'
    put('bark', cylinder, trunkMaterial, f, [0, height * .48, 0], [.105 * size, height, .105 * size], '#ffffff')
    for (let k = 0; k < 4; k++) {
      const a = k * TAU / 4 + .4
      put('bark', cylinder, trunkMaterial, f, [Math.cos(a) * .09 * size, .055, Math.sin(a) * .09 * size], [.055 * size, .26 * size, .055 * size], '#f1dbb1', tilt(new THREE.Vector3(-Math.cos(a), 1, -Math.sin(a))))
    }
    if (species === 1) {
      for (let tier = 0; tier < 4; tier++) {
        const radius = (.40 - tier * .075) * size; const y = height * .65 + tier * .22 * size
        put('cedar', cone, plain, f, [0, y + .15 * size, 0], [radius, .58 * size, radius], new THREE.Color(canopy).multiplyScalar(1 + tier * .08))
        for (let k = 0; k < 16; k++) {
          const angle = k / 16 * TAU
          put('leaves', leaf, leaves, f, [Math.cos(angle) * radius * .55, y + .16 * size, Math.sin(angle) * radius * .55], [.17 * size, .36 * size, .17 * size], new THREE.Color(canopy).multiplyScalar(range(.88, 1.25)), tilt(new THREE.Vector3(Math.cos(angle) * .6, -.85, Math.sin(angle) * .6)))
        }
      }
    } else {
      for (let tier = 0; tier < 4; tier++) {
        const radius = Math.sin((tier + 1) / 5 * Math.PI) * .42 * size
        const y = height + tier * .17 * size
        put('crowns', sphere, plain, f, [0, y, 0], [radius, .23 * size, radius], canopy)
        const count = 14 + (tier === 1 ? 4 : 0)
        for (let k = 0; k < count; k++) {
          const angle = k / count * TAU + tier * .55
          const spread = radius * range(.75, .9)
          const shade = new THREE.Color(canopy).multiplyScalar(range(.83, 1.26))
          put('leaves', leaf, leaves, f, [Math.cos(angle) * spread, y + .13 * size, Math.sin(angle) * spread], [.25 * size, .32 * size, .25 * size], shade, tilt(new THREE.Vector3(Math.cos(angle) * .5, -.72, Math.sin(angle) * .5)))
        }
      }
      if (species === 3) for (let k = 0; k < 5; k++) {
        const angle = k * TAU / 5
        put('fruit', sphere, plain, f, [Math.cos(angle) * .36 * size, height + .08, Math.sin(angle) * .36 * size], [.072, .08, .072], '#efa044')
      }
    }
  }
  // A Fibonacci distribution is perturbed and thinned by the terrain: every shore and grove differs.
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < 340; i++) {
    const y = 1 - (i + .5) / 340 * 2; const angle = i * golden + range(-.1, .1)
    const d = new THREE.Vector3(Math.sqrt(1 - y * y) * Math.cos(angle), y, Math.sqrt(1 - y * y) * Math.sin(angle))
    const t = terrain(d)
    if (t.waterDistance < .075 || nearest(d, pathPoints) < .055 || field(d, 2.2) > .47 || random() > .74) continue
    if (inClearing(d, .14)) continue
    treePlaces.push(d)
    const region = field(d, 1.7)
    tree(d, region < -.2 ? 1 : d.x < -.25 && d.y < .1 && field(d, 3) > .15 ? 2 : region > .3 ? 3 : 0)
  }
  const flowerColors = ['#fff4c2', '#f3c84e', '#f09b99', '#ded3f1', '#fefcf1']
  for (let i = 0; i < 2700; i++) {
    const d = spherical(random() * TAU, Math.asin(range(-1, 1))); const t = terrain(d)
    if (t.waterDistance < .045 || inClearing(d, .025)) continue
    const onPath = nearest(d, pathPoints) < .025
    const f = frame(d)
    if (i % 4 === 0 && !onPath) {
      const region = Math.floor((field(d, 2) + 1) * 3) % flowerColors.length
      const color = flowerColors[region]; const height = range(.09, .19)
      for (let flower = 0; flower < 3; flower++) {
        const x = range(-.11, .11); const z = range(-.11, .11)
        put('stems', cylinder, plain, f, [x, height * .5, z], [.009, height, .009], '#487447', undefined, false)
        for (let petal = 0; petal < 5; petal++) {
          const a = petal * TAU / 5
          put('flowers', sphere, plain, f, [x + Math.cos(a) * .029, height, z + Math.sin(a) * .029], [.035, .022, .035], color, undefined, false)
        }
        put('pollen', sphere, plain, f, [x, height + .014, z], [.022, .016, .022], '#e8b648', undefined, false)
        put('leaves', leaf, leaves, f, [x, .035, z], [.06, .11, .06], '#699252', tilt(new THREE.Vector3(.8, .3, .2)), false)
      }
    } else if (i % 21 === 0 && !onPath) {
      put('rocks', stone, plain, f, [0, .08, 0], [range(.09, .21), range(.08, .18), range(.08, .18)], ['#aab5b1', '#889c9e', '#c4c8bc'][i % 3])
    } else if (i % 19 === 0 && !onPath) {
      for (let j = 0; j < 3; j++) {
        const x = j * .065
        put('mushroom-stem', cylinder, plain, f, [x, .07, 0], [.025, .13, .025], '#efe3bf')
        put('mushroom-cap', sphere, plain, f, [x, .13, 0], [.073, .037, .067], j % 2 ? '#dba765' : '#c87350')
      }
    } else if (!onPath) {
      for (let j = 0; j < 3; j++) put('grass', leaf, leaves, f, [range(-.04, .04), 0, range(-.04, .04)], [.028, range(.055, .14), .025], random() > .5 ? '#8aaa6c' : '#527b4b', tilt(new THREE.Vector3(range(-.4, .4), 1, range(-.4, .4))), false)
    }
  }
  // Small fern bushes and naturally fallen timber around the woods.
  for (let i = 0; i < 150; i++) {
    const d = spherical(random() * TAU, Math.asin(range(-1, 1))); if (terrain(d).waterDistance < .045 || inClearing(d, .08)) continue
    const f = frame(d)
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU
      put('leaves', leaf, leaves, f, [0, .025, 0], [.15, range(.19, .32), .15], k % 2 ? '#4b7b54' : '#7e9e6b', tilt(new THREE.Vector3(Math.cos(a), .4, Math.sin(a))))
    }
    if (i % 15 === 0) {
      put('bark', cylinder, trunkMaterial, f, [.2, .10, .05], [.085, .47, .085], '#d2b791', tilt(new THREE.Vector3(1, .07, .25)))
      put('log-end', cylinder, plain, f, [.435, .115, .11], [.073, .009, .073], '#e5c68e', tilt(new THREE.Vector3(1, .07, .25)))
    }
  }
  // Three different little footbridges follow the river's tangent on the sphere.
  for (const [river, index] of [[0, 54], [1, 36], [2, 43]]) {
    const d = rivers[river][index]; const t = rivers[river][index + 1].clone().sub(d).normalize()
    const across = new THREE.Vector3().crossVectors(d, t).normalize()
    const basis = new THREE.Matrix4().makeBasis(across, d, new THREE.Vector3().crossVectors(across, d).normalize())
    basis.setPosition(d.clone().multiplyScalar(5.39))
    for (let k = 0; k < 11; k++) {
      const x = (k - 5) * .10
      put('bridge', box, plain, basis, [x, .04 + .075 * Math.cos(x * 2.8), 0], [.09, .055, .36], k % 2 ? '#c99d65' : '#dbb27a')
    }
    for (const x of [-.45, .45]) for (const z of [-.20, .20]) put('bark', cylinder, trunkMaterial, basis, [x, .22, z], [.028, .4, .028], '#d9bb8c')
    for (const z of [-.20, .20]) put('bridge', box, plain, basis, [0, .35, z], [1.02, .045, .04], '#dcc297')
  }
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length)
    batch.matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, batch.colors[i]) })
    mesh.castShadow = batch.shadow; mesh.receiveShadow = true; mesh.computeBoundingSphere(); world.add(mesh)
  }
  const wildlife = createWildlife({ world, terrain, trees: treePlaces, lakes, rivers, meetingCenter, clearingRadius })
  const space = createSpaceEnvironment(scene, world, camera)
  root.dataset.wildlife = String(wildlife.count)
  root.dataset.species = String(wildlife.speciesCount)
  root.querySelector('.animal-edition__live')!.innerHTML = `<i></i>${wildlife.speciesCount}종, ${wildlife.count}마리와 함께하는 작은 우주`
  root.dataset.trees = String(treePlaces.length)
  root.querySelector('.animal-edition__loading')?.remove()
  let active = false; let paused = false; let animation = 0; let fitDistance = 24
  const music = createEditionMusic(`${import.meta.env.BASE_URL}forest-bgm.mp3`)
  let studioOpen = false
  let extension: ReturnType<typeof createExtendedResidents> | null = null
  const syncControls = () => { controls.enabled = active && !paused && !studioOpen && !residents.introducing && !extension?.cameraLocked }
  const residentOptions = { root, world, scene, camera, terrain, trees: treePlaces,
    onIntroduction: (value: boolean) => { syncControls(); moveIn.setDisabled(value) },
    onCount: (count: number) => moveIn.setCount(count),
  }
  const residents = extended ? extension = createExtendedResidents({ ...residentOptions, canvas: renderer.domElement, controls, ground, meetingCenter, wildlife: wildlife.animals,
    setSinkhole: (center, amount) => { sinkCenter.value.copy(center); sinkAmount.value = amount },
    canInteract: () => active && !paused && !studioOpen,
  }) : createResidents(residentOptions)
  const moveIn = createMoveIn({ root,
    onCreate: (photo, analysis, name) => residents.create(photo, analysis, name),
    onOpen: open => { studioOpen = open; if (open) extension?.suspend(); syncControls() },
  })
  moveIn.setDisabled(true)
  void residents.ready.then(() => moveIn.setDisabled(residents.introducing))
  function resize() {
    const width = viewport.clientWidth; const height = viewport.clientHeight
    if (!width || !height) return
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height)
    const limitingFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect))
    if (active && (extension?.cameraLocked || residents.introducing)) return
    const zoomRatio = active ? camera.position.length() / fitDistance : 1
    fitDistance = 10.3 / Math.sin(limitingFov / 2)
    controls.maxDistance = Math.max(38, fitDistance * 1.5)
    if (camera.position.length() < .1 || !active) camera.position.set(0, .3, fitDistance)
    else camera.position.setLength(fitDistance * zoomRatio)
  }
  function animate(now: number) {
    if (!active || paused || document.hidden) return
    animation = requestAnimationFrame(animate); if (controls.enabled) controls.update(); wildlife.update(now); residents.update(now)
    space.update(now, !!extension?.following, residents.introducing)
    if (extended) { followFocus.value.copy(controls.target); followVisibility.value = THREE.MathUtils.lerp(followVisibility.value, extension?.following ? 1 : 0, .32) }
    if (waterShader) waterShader.uniforms.forestTime.value = now / 1000
    renderer.render(scene, camera)
  }
  window.addEventListener('resize', resize)
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault())
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(animation)
    if (!document.hidden && active && !paused) { wildlife.resetClock(); space.resetClock(); animation = requestAnimationFrame(animate) }
  })
  const captureCanvas = document.createElement('canvas')
  const captureContext = captureCanvas.getContext('2d')!
  function captureFrame() {
    const source = renderer.domElement
    if (captureCanvas.width !== source.width || captureCanvas.height !== source.height) {
      captureCanvas.width = source.width; captureCanvas.height = source.height
    }
    const w = source.width; const h = source.height
    const gradient = captureContext.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * .65)
    gradient.addColorStop(0, '#203043'); gradient.addColorStop(.5, '#182535'); gradient.addColorStop(1, '#0c1720')
    captureContext.fillStyle = gradient; captureContext.fillRect(0, 0, w, h)
    captureContext.drawImage(source, 0, 0)
    return captureCanvas
  }
  return {
    start() { if (active) return; resize(); wildlife.resetClock(); space.resetClock(); active = true; paused = false; music.start(); syncControls(); animation = requestAnimationFrame(animate) },
    stop() { active = false; music.stop(); moveIn.close(); residents.stop(); controls.enabled = false; cancelAnimationFrame(animation) },
    resize,
    captureFrame,
    setPaused(value: boolean) { wildlife.resetClock(); space.resetClock(); paused = value; if (value) extension?.suspend(); syncControls(); cancelAnimationFrame(animation); if (active && !paused) animation = requestAnimationFrame(animate) },
  }
}
