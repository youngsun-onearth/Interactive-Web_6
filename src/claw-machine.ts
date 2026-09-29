import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as CANNON from 'cannon-es'

type ClawState =
  | 'ready'
  | 'lowering'
  | 'closing'
  | 'lifting'
  | 'delivering'
  | 'releasing'
  | 'returning'

type Plush = {
  group: THREE.Group
  body: CANNON.Body
  kind: number
  color: number
  accent: number
  name: string
  captured: boolean
  falling: boolean
  fallVelocity: number
  spin: number
}

type ClawFinger = {
  root: THREE.Group
  knuckle: THREE.Group
}

const HOME_HEIGHT = 6.15
const DROP_HEIGHT = 2.15
const EXIT_POSITION = new THREE.Vector3(0, HOME_HEIGHT, 2.15)
const X_LIMIT = 3.65
const Z_MIN = -2.15
const Z_MAX = 2.15

const easeInOut = (value: number) =>
  value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2

const makeMaterial = (color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.03, ...options })

const prepareMesh = (mesh: THREE.Mesh, receiveShadow = false) => {
  mesh.castShadow = true
  mesh.receiveShadow = receiveShadow
  return mesh
}

const addSphere = (
  parent: THREE.Object3D,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  segments = 24,
) => {
  const mesh = prepareMesh(new THREE.Mesh(new THREE.SphereGeometry(0.5, segments, Math.max(12, segments / 2)), material))
  mesh.position.set(...position)
  mesh.scale.set(...scale)
  parent.add(mesh)
  return mesh
}

const addEye = (parent: THREE.Object3D, x: number, y: number, z: number, scale = 1) => {
  const eye = addSphere(parent, makeMaterial(0x17151a, { roughness: 0.3 }), [x, y, z], [0.095 * scale, 0.12 * scale, 0.07])
  const glint = addSphere(parent, makeMaterial(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25 }), [x - 0.024, y + 0.035, z + 0.045], [0.025, 0.025, 0.018], 16)
  return { eye, glint }
}

const createPlush = (kind: number, color: number, accent: number) => {
  const group = new THREE.Group()
  const fur = makeMaterial(color, { roughness: 0.96 })
  const detail = makeMaterial(accent, { roughness: 0.88 })
  const dark = makeMaterial(0x201a22, { roughness: 0.55 })

  addSphere(group, fur, [0, 0.65, 0], [1.05, 1.15, 0.82])
  addSphere(group, fur, [0, 1.55, 0.02], [0.9, 0.82, 0.76])
  addSphere(group, fur, [-0.57, 0.67, 0], [0.42, 0.78, 0.42])
  addSphere(group, fur, [0.57, 0.67, 0], [0.42, 0.78, 0.42])
  addSphere(group, fur, [-0.35, 0.02, 0.06], [0.5, 0.62, 0.54])
  addSphere(group, fur, [0.35, 0.02, 0.06], [0.5, 0.62, 0.54])

  if (kind === 0 || kind === 4) {
    addSphere(group, kind === 4 ? dark : fur, [-0.43, 1.96, 0], [0.46, 0.46, 0.38])
    addSphere(group, kind === 4 ? dark : fur, [0.43, 1.96, 0], [0.46, 0.46, 0.38])
    addSphere(group, detail, [0, 1.35, 0.38], [0.48, 0.35, 0.23])
    if (kind === 4) {
      addSphere(group, dark, [-0.31, 1.66, 0.3], [0.27, 0.23, 0.12])
      addSphere(group, dark, [0.31, 1.66, 0.3], [0.27, 0.23, 0.12])
    }
  } else if (kind === 1) {
    addSphere(group, fur, [-0.32, 2.3, -0.02], [0.34, 0.92, 0.31])
    addSphere(group, fur, [0.32, 2.3, -0.02], [0.34, 0.92, 0.31])
    addSphere(group, detail, [-0.32, 2.3, 0.13], [0.14, 0.64, 0.1])
    addSphere(group, detail, [0.32, 2.3, 0.13], [0.14, 0.64, 0.1])
  } else if (kind === 2) {
    const beak = prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 4), detail))
    beak.position.set(0, 1.42, 0.48)
    beak.rotation.x = Math.PI / 2
    beak.rotation.z = Math.PI / 4
    group.add(beak)
    addSphere(group, detail, [-0.35, -0.12, 0.46], [0.45, 0.18, 0.4])
    addSphere(group, detail, [0.35, -0.12, 0.46], [0.45, 0.18, 0.4])
  } else if (kind === 3) {
    ;[-0.48, 0.48].forEach((x) => {
      const ear = prepareMesh(new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.78, 4), fur))
      ear.position.set(x, 2.22, 0)
      ear.rotation.z = x < 0 ? 0.1 : -0.1
      ear.rotation.y = Math.PI / 4
      group.add(ear)
    })
    addSphere(group, detail, [0, 1.34, 0.4], [0.3, 0.24, 0.16])
  } else {
    addSphere(group, fur, [-0.31, 1.96, 0], [0.38, 0.4, 0.36])
    addSphere(group, fur, [0.31, 1.96, 0], [0.38, 0.4, 0.36])
    addSphere(group, detail, [0, 0.65, 0.42], [0.66, 0.75, 0.16])
  }

  if (kind !== 4) {
    addEye(group, -0.27, 1.67, 0.335)
    addEye(group, 0.27, 1.67, 0.335)
  } else {
    addEye(group, -0.31, 1.67, 0.38, 0.85)
    addEye(group, 0.31, 1.67, 0.38, 0.85)
  }
  addSphere(group, dark, [0, 1.42, 0.49], [0.105, 0.085, 0.07], 16)
  addSphere(group, dark, [0, 1.27, 0.43], [0.12, 0.045, 0.045], 16)

  const neckSeam = prepareMesh(new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 7, 36), detail))
  neckSeam.position.set(0, 1.08, 0.02)
  neckSeam.rotation.x = Math.PI / 2
  neckSeam.scale.z = 0.82
  group.add(neckSeam)

  group.scale.setScalar(0.55)
  group.rotation.y = (Math.random() - 0.5) * 0.7
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.userData.plush = true
  })
  return group
}

export const createClawMachine = (element: HTMLElement) => {
  const viewport = element.querySelector<HTMLElement>('.claw-machine__viewport')!
  const status = element.querySelector<HTMLElement>('.claw-machine__status')!
  const count = element.querySelector<HTMLElement>('.claw-machine__count')!
  const coordinates = element.querySelector<HTMLElement>('.claw-machine__coordinates')!
  const actionButton = element.querySelector<HTMLButtonElement>('.claw-machine__drop')!
  const moveButtons = element.querySelectorAll<HTMLButtonElement>('[data-claw-move]')
  const prizeButton = element.querySelector<HTMLButtonElement>('.claw-machine__score')!
  const prizeList = element.querySelector<HTMLElement>('.claw-machine__prize-list')!
  const prizePanelClose = element.querySelector<HTMLButtonElement>('.claw-machine__prizes-close')!
  const viewer = element.querySelector<HTMLElement>('.claw-machine__collection-viewer')!
  const viewerName = element.querySelector<HTMLElement>('.claw-machine__viewer-name')!
  const viewerClose = element.querySelector<HTMLButtonElement>('.claw-machine__viewer-close')!
  const scene = new THREE.Scene()
  const previewScene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80)
  const previewCamera = new THREE.OrthographicCamera(-2.3, 2.3, 2.3, -2.3, 0.1, 20)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'default' })
  const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -8.8, 0) })
  physicsWorld.allowSleep = true
  const plushPhysicsMaterial = new CANNON.Material('soft-plush')
  const clock = new THREE.Clock()
  const pressed = new Set<string>()
  const plushes: Plush[] = []
  const capturedPrizes: Plush[] = []
  const fallingPrizes = new Set<Plush>()
  const clawFingers: ClawFinger[] = []
  const startPosition = new THREE.Vector3(0.45, HOME_HEIGHT, 0.15)
  const phaseStart = new THREE.Vector3()
  const phaseEnd = new THREE.Vector3()
  const claw = new THREE.Group()
  const trolley = new THREE.Group()
  let cable: THREE.Mesh
  let reticle: THREE.Mesh
  let orbit: OrbitControls | null = null
  let previewPrize: THREE.Group | null = null
  let previewTime = 0
  let previewMode: 'win' | 'collection' | null = null
  let frame = 0
  let initialized = false
  let running = false
  let state: ClawState = 'ready'
  let stateTime = 0
  let stateDuration = 1
  let attachedPrize: Plush | null = null
  let candidatePrize: Plush | null = null
  let unstableDropAt = Number.POSITIVE_INFINITY
  let capturedCount = 0

  const box = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = scene,
  ) => {
    const mesh = prepareMesh(new THREE.Mesh(new THREE.BoxGeometry(...size), material), true)
    mesh.position.set(...position)
    parent.add(mesh)
    return mesh
  }

  const setStatus = (message: string, busy = false) => {
    status.textContent = message
    element.classList.toggle('is-busy', busy)
    actionButton.disabled = busy
    moveButtons.forEach((button) => { button.disabled = busy })
  }

  const updateCoordinates = () => {
    const x = Math.round(((claw.position.x + X_LIMIT) / (X_LIMIT * 2)) * 100)
    const z = Math.round(((claw.position.z - Z_MIN) / (Z_MAX - Z_MIN)) * 100)
    coordinates.textContent = `X ${x.toString().padStart(2, '0')} · Z ${z.toString().padStart(2, '0')}`
  }

  const setClawOpen = (amount: number) => {
    clawFingers.forEach(({ root, knuckle }) => {
      root.rotation.z = THREE.MathUtils.lerp(-0.05, 0.42, amount)
      knuckle.rotation.z = THREE.MathUtils.lerp(-0.34, 0.02, amount)
    })
  }

  const updateCable = () => {
    const length = Math.max(0.15, 6.72 - claw.position.y)
    trolley.position.set(claw.position.x, 6.72, claw.position.z)
    cable.position.set(claw.position.x, 6.72 - length / 2, claw.position.z)
    cable.scale.y = length
  }

  const addPhysicsCabinet = () => {
    physicsWorld.allowSleep = true
    physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld)
    physicsWorld.defaultContactMaterial.friction = 0.82
    physicsWorld.defaultContactMaterial.restitution = 0.04
    physicsWorld.addContactMaterial(new CANNON.ContactMaterial(
      plushPhysicsMaterial,
      plushPhysicsMaterial,
      { friction: 0.9, restitution: 0.03, contactEquationStiffness: 8e6 },
    ))

    const addStaticBox = (halfExtents: CANNON.Vec3, position: CANNON.Vec3) => {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(halfExtents), position })
      physicsWorld.addBody(body)
    }

    addStaticBox(new CANNON.Vec3(4.82, 0.14, 3.25), new CANNON.Vec3(0, 0.72, 0))
    addStaticBox(new CANNON.Vec3(0.12, 3.4, 3.25), new CANNON.Vec3(-4.72, 3.8, 0))
    addStaticBox(new CANNON.Vec3(0.12, 3.4, 3.25), new CANNON.Vec3(4.72, 3.8, 0))
    addStaticBox(new CANNON.Vec3(4.82, 3.4, 0.12), new CANNON.Vec3(0, 3.8, -3.22))
    addStaticBox(new CANNON.Vec3(4.82, 3.4, 0.12), new CANNON.Vec3(0, 3.8, 3.22))
  }

  const addCabinet = () => {
    const shell = makeMaterial(0xde3158, { roughness: 0.28, metalness: 0.52 })
    const shellDark = makeMaterial(0x761a3c, { roughness: 0.36, metalness: 0.45 })
    const floorMat = makeMaterial(0xe7d9d3, { roughness: 0.86 })
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xbfe9f4,
      transparent: true,
      opacity: 0.12,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.45,
      thickness: 0.18,
      side: THREE.DoubleSide,
    })
    box([10.4, 3.15, 7.3], [0, -0.93, 0], shellDark)
    box([9.65, 0.28, 6.55], [0, 0.72, 0], floorMat)
    box([10.4, 0.52, 7.3], [0, 7.75, 0], shell)

    ;[-4.92, 4.92].forEach((x) => {
      ;[-3.35, 3.35].forEach((z) => box([0.36, 7.15, 0.36], [x, 4.05, z], shell))
    })
    ;[-3.35, 3.35].forEach((z) => box([10.1, 0.3, 0.32], [0, 7.35, z], shell))
    ;[-4.92, 4.92].forEach((x) => box([0.32, 0.3, 6.5], [x, 7.35, 0], shell))

    const backGlass = box([9.45, 6.45, 0.055], [0, 4.03, -3.22], glass)
    backGlass.castShadow = false
    const leftGlass = box([0.055, 6.45, 6.15], [-4.72, 4.03, 0], glass)
    const rightGlass = box([0.055, 6.45, 6.15], [4.72, 4.03, 0], glass)
    leftGlass.castShadow = false
    rightGlass.castShadow = false

    const railMat = makeMaterial(0x353942, { roughness: 0.32, metalness: 0.9 })
    box([9.15, 0.13, 0.17], [0, 6.85, -2.25], railMat)
    box([9.15, 0.13, 0.17], [0, 6.85, 2.25], railMat)
    box([0.16, 0.13, 4.55], [0, 0, 0], railMat, trolley)

    const chuteDark = makeMaterial(0x130f18, { roughness: 0.7 })
    box([2.15, 0.11, 1.55], [0, 0.84, 2.15], chuteDark)
    box([2.35, 0.24, 0.16], [0, 0.96, 2.96], shell)
    box([0.16, 0.24, 1.65], [-1.16, 0.96, 2.15], shell)
    box([0.16, 0.24, 1.65], [1.16, 0.96, 2.15], shell)

    box([2.45, 1.42, 0.12], [0, -0.92, 3.67], chuteDark)
    box([2.75, 0.18, 0.25], [0, -0.16, 3.7], shell)
    box([2.75, 0.18, 0.25], [0, -1.68, 3.7], shell)
    box([0.18, 1.7, 0.25], [-1.37, -0.92, 3.7], shell)
    box([0.18, 1.7, 0.25], [1.37, -0.92, 3.7], shell)
    box([2.15, 0.18, 0.75], [0, -1.62, 3.25], makeMaterial(0x4f233a, { roughness: 0.62 }))

    const ringGeometry = new THREE.RingGeometry(0.36, 0.48, 48)
    reticle = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffef9b, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
    reticle.rotation.x = -Math.PI / 2
    reticle.position.set(startPosition.x, 0.91, startPosition.z)
    scene.add(reticle)
  }

  const addClaw = () => {
    const metal = makeMaterial(0xc9d0d6, { roughness: 0.18, metalness: 0.92 })
    const darkMetal = makeMaterial(0x454b52, { roughness: 0.22, metalness: 0.88 })
    const rubber = makeMaterial(0x24262b, { roughness: 0.72 })
    cable = prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), darkMetal))
    scene.add(cable)

    const trolleyBody = prepareMesh(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.34, 0.72), darkMetal))
    trolley.add(trolleyBody)
    scene.add(trolley)

    const hub = prepareMesh(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.48, 24), metal))
    hub.position.y = -0.08
    claw.add(hub)
    const collar = prepareMesh(new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.055, 10, 32), darkMetal))
    collar.rotation.x = Math.PI / 2
    collar.position.y = -0.3
    claw.add(collar)

    const addFingerSegment = (
      parent: THREE.Object3D,
      start: THREE.Vector3,
      end: THREE.Vector3,
      radius: number,
    ) => {
      const direction = end.clone().sub(start)
      const segment = prepareMesh(new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, Math.max(0.05, direction.length() - radius * 2), 6, 12),
        metal,
      ))
      segment.position.copy(start).add(end).multiplyScalar(0.5)
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      parent.add(segment)
    }

    for (let index = 0; index < 3; index += 1) {
      const radial = new THREE.Group()
      radial.rotation.y = index * (Math.PI * 2 / 3)
      const root = new THREE.Group()
      root.position.set(0.32, -0.23, 0)
      radial.add(root)
      const rootJoint = prepareMesh(new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), darkMetal))
      root.add(rootJoint)
      const knucklePosition = new THREE.Vector3(0.34, -0.72, 0)
      addFingerSegment(root, new THREE.Vector3(), knucklePosition, 0.085)
      const knuckle = new THREE.Group()
      knuckle.position.copy(knucklePosition)
      root.add(knuckle)
      const knuckleJoint = prepareMesh(new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), darkMetal))
      knuckle.add(knuckleJoint)
      const tipPosition = new THREE.Vector3(-0.25, -0.62, 0)
      addFingerSegment(knuckle, new THREE.Vector3(), tipPosition, 0.09)
      const tip = prepareMesh(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), rubber))
      tip.position.copy(tipPosition)
      knuckle.add(tip)
      claw.add(radial)
      clawFingers.push({ root, knuckle })
    }
    claw.position.copy(startPosition)
    scene.add(claw)
    setClawOpen(1)
    updateCable()
  }

  const addPlushes = () => {
    const palette = [
      [0xe8a66f, 0xf3d3ae], [0xe8a8c8, 0xf7d8e7], [0xf4ca45, 0xe47735],
      [0x84b9df, 0xe8c5cd], [0xf2eee7, 0xddd7cc], [0x8bc987, 0xe7f0ae],
      [0xad8bd8, 0xe5cef6], [0xede5d4, 0xe8b8c1], [0xef7c74, 0xf1c5aa],
      [0x63c8bd, 0xd8f1dc], [0x8596e8, 0xd5dbff], [0xe2a957, 0xffe0a3],
    ]
    const positions = [
      [-3.7, -1.9], [-2.25, -1.85], [-0.75, -1.95], [0.75, -1.82], [2.2, -1.95], [3.65, -1.82],
      [-3.85, -0.62], [-2.55, -0.55], [-1.18, -0.7], [0.2, -0.5], [1.55, -0.68], [2.85, -0.52], [4.0, -0.72],
      [-3.65, 0.65], [-2.3, 0.78], [-0.95, 0.58], [0.55, 0.72], [1.9, 0.58], [3.4, 0.76],
      [-3.15, 1.7], [-1.72, 1.55], [1.62, 1.62], [3.12, 1.56],
    ]
    const names = ['테디 베어', '롱이어 버니', '레몬 덕', '스카이 캣', '밀크 판다', '그린 프로그']

    Array.from({ length: 46 }, (_, index) => index).forEach((index) => {
      const slot = index % positions.length
      const layer = Math.floor(index / positions.length)
      const [baseX, baseZ] = positions[slot]
      const [color, accent] = palette[index % palette.length]
      const kind = index % 6
      const size = 0.9 + (index % 5) * 0.045
      const group = createPlush(kind, color, accent)
      const body = new CANNON.Body({
        mass: 0.58 + (index % 4) * 0.06,
        material: plushPhysicsMaterial,
        position: new CANNON.Vec3(
          baseX + (layer ? 0.16 : -0.08),
          layer ? 4.2 + (slot % 5) * 0.42 : 1.55 + (slot % 4) * 0.36,
          baseZ + (layer ? -0.12 : 0.08),
        ),
      })

      group.scale.multiplyScalar(size)
      body.addShape(new CANNON.Sphere(0.41 * size), new CANNON.Vec3(0, 0.34 * size, 0))
      body.addShape(new CANNON.Sphere(0.35 * size), new CANNON.Vec3(0, 0.85 * size, 0))
      body.addShape(new CANNON.Sphere(0.21 * size), new CANNON.Vec3(-0.22 * size, 0.02, 0))
      body.addShape(new CANNON.Sphere(0.21 * size), new CANNON.Vec3(0.22 * size, 0.02, 0))
      body.addShape(new CANNON.Sphere(0.24 * size), new CANNON.Vec3(-0.34 * size, 0.4 * size, 0))
      body.addShape(new CANNON.Sphere(0.24 * size), new CANNON.Vec3(0.34 * size, 0.4 * size, 0))
      if ([0, 1, 3, 4, 5].includes(kind)) {
        body.addShape(new CANNON.Sphere(0.3 * size), new CANNON.Vec3(0, 1.22 * size, 0))
      }
      body.linearDamping = 0.16
      body.angularDamping = 0.52
      body.sleepSpeedLimit = 0.08
      body.sleepTimeLimit = 0.7
      body.quaternion.setFromEuler(
        (Math.random() - 0.5) * 1.5,
        (index * 1.73) % (Math.PI * 2),
        (Math.random() - 0.5) * 1.5,
      )
      body.angularVelocity.set(
        (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.7,
      )
      group.position.set(body.position.x, body.position.y, body.position.z)
      group.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
      scene.add(group)
      physicsWorld.addBody(body)
      plushes.push({
        group,
        body,
        kind,
        color,
        accent,
        name: `${names[kind]} ${String(index + 1).padStart(2, '0')}`,
        captured: false,
        falling: false,
        fallVelocity: 0,
        spin: 0,
      })
    })
  }

  const initialize = () => {
    if (initialized) return
    initialized = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.autoClear = false
    renderer.domElement.style.touchAction = 'none'
    viewport.append(renderer.domElement)
    scene.background = new THREE.Color(0x17141e)
    scene.fog = new THREE.Fog(0x17141e, 17, 31)

    const hemi = new THREE.HemisphereLight(0xe7f4ff, 0x5b324a, 2.3)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff1df, 4.4)
    key.position.set(4, 11, 8)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -8
    key.shadow.camera.right = 8
    key.shadow.camera.top = 9
    key.shadow.camera.bottom = -5
    scene.add(key)
    const pink = new THREE.PointLight(0xff477e, 28, 18, 2)
    pink.position.set(-4, 6.5, 3)
    scene.add(pink)
    const cyan = new THREE.PointLight(0x69d8ff, 22, 16, 2)
    cyan.position.set(4, 5, -2)
    scene.add(cyan)

    previewScene.add(new THREE.HemisphereLight(0xffffff, 0x4a263d, 3.2))
    const previewLight = new THREE.DirectionalLight(0xfff1dc, 5.5)
    previewLight.position.set(3, 6, 5)
    previewScene.add(previewLight)
    previewCamera.position.set(0, 0, 7)
    previewCamera.lookAt(0, 0, 0)

    const ground = prepareMesh(new THREE.Mesh(new THREE.PlaneGeometry(40, 30), makeMaterial(0x100e15, { roughness: 0.92 })), true)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -2.53
    scene.add(ground)
    addCabinet()
    addClaw()
    addPhysicsCabinet()
    addPlushes()
    for (let step = 0; step < 240; step += 1) physicsWorld.step(1 / 60)
    plushes.forEach((prize) => {
      prize.group.position.set(prize.body.position.x, prize.body.position.y, prize.body.position.z)
      prize.group.quaternion.set(
        prize.body.quaternion.x,
        prize.body.quaternion.y,
        prize.body.quaternion.z,
        prize.body.quaternion.w,
      )
    })
    resize()
    orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.set(0, 2.55, 0)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.07
    orbit.enablePan = false
    orbit.minDistance = 12.5
    orbit.maxDistance = 23
    orbit.minPolarAngle = 0.65
    orbit.maxPolarAngle = 1.48
    orbit.rotateSpeed = 0.68
    orbit.zoomSpeed = 0.72
    orbit.touches.ONE = THREE.TOUCH.ROTATE
    orbit.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
    orbit.update()
  }

  const chooseCandidate = () => {
    let nearest: Plush | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    plushes.forEach((plush) => {
      if (plush.captured || plush.falling) return
      const distance = Math.hypot(plush.group.position.x - claw.position.x, plush.group.position.z - claw.position.z)
      if (distance < nearestDistance) {
        nearest = plush
        nearestDistance = distance
      }
    })
    candidatePrize = nearestDistance < 1.05 ? nearest : null
  }

  const beginPhase = (nextState: ClawState, duration: number, destination?: THREE.Vector3) => {
    state = nextState
    stateTime = 0
    stateDuration = duration
    phaseStart.copy(claw.position)
    phaseEnd.copy(destination ?? claw.position)
  }

  const startDrop = () => {
    if (!running || state !== 'ready' || element.classList.contains('is-prize-panel-open')) return
    pressed.clear()
    chooseCandidate()
    beginPhase('lowering', 1.18, new THREE.Vector3(claw.position.x, DROP_HEIGHT, claw.position.z))
    setStatus('집게가 내려가고 있어요', true)
  }

  const attachCandidate = () => {
    if (!candidatePrize) return
    const distance = Math.hypot(
      candidatePrize.group.position.x - claw.position.x,
      candidatePrize.group.position.z - claw.position.z,
    )
    const grabChance = THREE.MathUtils.clamp(0.92 - distance * 0.55, 0.28, 0.9)
    if (Math.random() > grabChance) return
    attachedPrize = candidatePrize
    physicsWorld.removeBody(attachedPrize.body)
    claw.attach(attachedPrize.group)
    attachedPrize.group.position.set((Math.random() - 0.5) * 0.16, -1.38, (Math.random() - 0.5) * 0.16)
    attachedPrize.group.rotation.set(0.08, Math.random() * Math.PI, (Math.random() - 0.5) * 0.25)
    unstableDropAt = Math.random() < 0.38 + distance * 0.28
      ? 0.22 + Math.random() * 0.62
      : Number.POSITIVE_INFINITY
  }

  const dropAttachedPrize = (captured: boolean) => {
    if (!attachedPrize) return
    const prize = attachedPrize
    scene.attach(prize.group)
    if (captured) {
      prize.falling = true
      prize.fallVelocity = -0.65
      prize.spin = (Math.random() - 0.5) * 2.4
      prize.group.userData.toExit = true
      prize.group.userData.exitStage = 'internal'
      fallingPrizes.add(prize)
    } else {
      prize.falling = false
      prize.body.position.set(prize.group.position.x, prize.group.position.y, prize.group.position.z)
      prize.body.quaternion.set(
        prize.group.quaternion.x,
        prize.group.quaternion.y,
        prize.group.quaternion.z,
        prize.group.quaternion.w,
      )
      prize.body.velocity.set((Math.random() - 0.5) * 0.45, -0.25, (Math.random() - 0.5) * 0.45)
      prize.body.angularVelocity.set((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.8)
      physicsWorld.addBody(prize.body)
      prize.body.wakeUp()
    }
    attachedPrize = null
  }

  const showPrizePreview = (prize: Plush) => {
    if (previewPrize) previewScene.remove(previewPrize)
    previewPrize = prize.group.clone(true)
    previewPrize.visible = true
    previewPrize.position.set(0, -0.85, 0)
    previewPrize.rotation.set(0.08, -0.35, -0.08)
    previewPrize.scale.setScalar(0.72)
    previewScene.add(previewPrize)
    previewTime = 0
    previewMode = 'win'
    element.classList.add('has-prize-preview')
  }

  const closeCollectionViewer = () => {
    if (previewMode === 'collection' && previewPrize) previewScene.remove(previewPrize)
    if (previewMode === 'collection') previewPrize = null
    previewMode = null
    viewer.setAttribute('aria-hidden', 'true')
    element.classList.remove('is-viewing-prize')
  }

  const showCollectionPrize = (prize: Plush) => {
    if (previewPrize) previewScene.remove(previewPrize)
    previewPrize = prize.group.clone(true)
    previewPrize.visible = true
    previewPrize.position.set(0, -0.85, 0)
    previewPrize.rotation.set(0.08, -0.35, -0.08)
    previewPrize.scale.setScalar(1.14)
    previewScene.add(previewPrize)
    previewMode = 'collection'
    viewerName.textContent = prize.name
    viewer.setAttribute('aria-hidden', 'false')
    element.classList.remove('has-prize-preview')
    element.classList.add('is-viewing-prize')
  }

  const renderPrizeList = () => {
    if (capturedPrizes.length === 0) {
      prizeList.innerHTML = '<p class="claw-machine__prize-empty">아직 뽑은 인형이 없어요</p>'
      return
    }
    const icons = ['🧸', '🐰', '🐤', '🐱', '🐼', '🐸']
    prizeList.replaceChildren(...capturedPrizes.map((prize, index) => {
      const button = document.createElement('button')
      const swatch = document.createElement('span')
      const label = document.createElement('strong')
      const number = document.createElement('small')

      button.className = 'claw-prize-card'
      button.type = 'button'
      button.style.setProperty('--prize-color', new THREE.Color(prize.color).getStyle())
      button.style.setProperty('--prize-accent', new THREE.Color(prize.accent).getStyle())
      swatch.textContent = icons[prize.kind]
      label.textContent = prize.name
      number.textContent = `PRIZE ${String(index + 1).padStart(2, '0')}`
      button.append(swatch, label, number)
      button.addEventListener('click', () => showCollectionPrize(prize))
      return button
    }))
  }

  const setPrizePanelOpen = (open: boolean) => {
    if (!open) closeCollectionViewer()
    element.classList.toggle('is-prize-panel-open', open)
    prizeButton.setAttribute('aria-expanded', String(open))
  }

  const updatePrizePreview = (delta: number) => {
    if (!previewPrize) return
    if (previewMode === 'collection') {
      previewPrize.rotation.y += delta * 0.65
      return
    }
    previewTime += delta
    const entrance = Math.min(1, previewTime / 0.32)
    const exit = THREE.MathUtils.clamp((2 - previewTime) / 0.28, 0, 1)
    previewPrize.scale.setScalar((0.72 + easeInOut(entrance) * 0.5) * exit)
    previewPrize.rotation.y += delta * 0.55
    if (previewTime < 2) return
    previewScene.remove(previewPrize)
    previewPrize = null
    previewMode = null
    element.classList.remove('has-prize-preview')
  }

  const finishPhase = () => {
    if (state === 'lowering') {
      beginPhase('closing', 0.62)
      setStatus(candidatePrize ? '인형을 잡는 중…' : '집게를 닫는 중…', true)
    } else if (state === 'closing') {
      attachCandidate()
      beginPhase('lifting', 1.22, new THREE.Vector3(claw.position.x, HOME_HEIGHT, claw.position.z))
      setStatus(attachedPrize ? '잡았다! 조심히 올리는 중…' : '아쉽네요, 다시 올라가는 중…', true)
    } else if (state === 'lifting') {
      beginPhase('delivering', 1.75, EXIT_POSITION)
      setStatus(attachedPrize ? '출구로 옮기는 중…' : '출구로 이동하는 중…', true)
    } else if (state === 'delivering') {
      beginPhase('releasing', 0.72)
      setStatus(attachedPrize ? '출구에 인형을 놓습니다!' : '집게를 펼치는 중…', true)
    } else if (state === 'releasing') {
      dropAttachedPrize(true)
      beginPhase('returning', 1.55, startPosition)
      setStatus('다음 플레이를 준비하고 있어요', true)
    } else if (state === 'returning') {
      state = 'ready'
      stateTime = 0
      candidatePrize = null
      unstableDropAt = Number.POSITIVE_INFINITY
      setStatus('드래그로 둘러보고 · 방향키 이동 · SPACE 뽑기')
    }
  }

  const updateFallingPrizes = (delta: number) => {
    fallingPrizes.forEach((prize) => {
      prize.fallVelocity -= 7.8 * delta
      prize.group.position.y += prize.fallVelocity * delta
      prize.group.rotation.z += prize.spin * delta
      const toExit = Boolean(prize.group.userData.toExit)
      const exitStage = prize.group.userData.exitStage as string | undefined

      if (toExit && exitStage === 'internal' && prize.group.position.y <= 0.58) {
        prize.group.position.set(0, -0.36, 3.92)
        prize.group.rotation.set(0.15, Math.PI, (Math.random() - 0.5) * 0.35)
        prize.fallVelocity = -0.55
        prize.group.userData.exitStage = 'hatch'
        return
      }

      if (toExit && exitStage === 'hatch' && prize.group.position.y <= -1.92) {
        prize.falling = false
        prize.captured = true
        fallingPrizes.delete(prize)
        prize.group.visible = false
        capturedCount += 1
        count.textContent = String(capturedCount)
        capturedPrizes.push(prize)
        renderPrizeList()
        showPrizePreview(prize)
        delete prize.group.userData.toExit
        delete prize.group.userData.exitStage
        return
      }

      if (toExit) return
      const bounds = new THREE.Box3().setFromObject(prize.group)
      if (bounds.min.y > 0.86) return

      prize.falling = false
      fallingPrizes.delete(prize)
      prize.group.position.y += 0.86 - bounds.min.y
      prize.group.rotation.z = THREE.MathUtils.clamp(prize.group.rotation.z, -0.75, 0.75)
    })
  }

  const updatePlushPhysics = (delta: number) => {
    physicsWorld.step(1 / 60, delta, 4)
    plushes.forEach((prize) => {
      if (prize.captured || prize.falling || prize === attachedPrize) return
      if (prize.body.sleepState === CANNON.Body.SLEEPING) return
      prize.group.position.set(prize.body.position.x, prize.body.position.y, prize.body.position.z)
      prize.group.quaternion.set(
        prize.body.quaternion.x,
        prize.body.quaternion.y,
        prize.body.quaternion.z,
        prize.body.quaternion.w,
      )
    })
  }

  const updateMovement = (delta: number) => {
    if (state !== 'ready') return
    const horizontal = Number(pressed.has('ArrowRight')) - Number(pressed.has('ArrowLeft'))
    const depth = Number(pressed.has('ArrowUp')) - Number(pressed.has('ArrowDown'))
    if (!horizontal && !depth) return
    const vectorLength = Math.hypot(horizontal, depth) || 1
    claw.position.x = THREE.MathUtils.clamp(claw.position.x + (horizontal / vectorLength) * 2.55 * delta, -X_LIMIT, X_LIMIT)
    claw.position.z = THREE.MathUtils.clamp(claw.position.z - (depth / vectorLength) * 2.25 * delta, Z_MIN, Z_MAX)
    reticle.position.x = claw.position.x
    reticle.position.z = claw.position.z
    updateCoordinates()
  }

  const updateState = (delta: number) => {
    if (state === 'ready') return
    stateTime += delta
    const progress = Math.min(1, stateTime / stateDuration)
    const eased = easeInOut(progress)
    if (state === 'lowering' || state === 'lifting' || state === 'delivering' || state === 'returning') {
      claw.position.lerpVectors(phaseStart, phaseEnd, eased)
    }
    if (state === 'closing') setClawOpen(1 - eased)
    if (state === 'releasing') setClawOpen(eased)
    if ((state === 'lifting' || state === 'delivering') && attachedPrize && progress >= unstableDropAt) {
      dropAttachedPrize(false)
      setStatus('인형이 흔들리다 떨어졌어요…', true)
      unstableDropAt = Number.POSITIVE_INFINITY
    }
    if (progress >= 1) finishPhase()
  }

  const animate = () => {
    if (!running) return
    frame = requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.05)
    updatePlushPhysics(delta)
    updateMovement(delta)
    updateState(delta)
    updateFallingPrizes(delta)
    updatePrizePreview(delta)
    updateCable()
    orbit?.update()
    reticle.material instanceof THREE.MeshBasicMaterial && (reticle.material.opacity = 0.54 + Math.sin(performance.now() * 0.004) * 0.18)
    renderer.clear()
    renderer.render(scene, camera)
    if (previewPrize) {
      renderer.clearDepth()
      renderer.render(previewScene, previewCamera)
    }
  }

  const resize = () => {
    if (!initialized) return
    const width = Math.max(1, viewport.clientWidth)
    const height = Math.max(1, viewport.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    const previewHalfHeight = 2.3
    const previewHalfWidth = previewHalfHeight * (width / height)
    previewCamera.left = -previewHalfWidth
    previewCamera.right = previewHalfWidth
    previewCamera.top = previewHalfHeight
    previewCamera.bottom = -previewHalfHeight
    previewCamera.updateProjectionMatrix()
    if (width / height < 0.8) {
      camera.position.set(0, 4.8, 21)
      camera.fov = 38
    } else {
      camera.position.set(0, 4.7, 18.5)
      camera.fov = 34
    }
    camera.lookAt(0, 2.55, 0)
    camera.updateProjectionMatrix()
    if (orbit) {
      orbit.target.set(0, 2.55, 0)
      orbit.update()
    }
  }

  const setKeyIndicator = (code: string, active: boolean) => {
    const target = code === 'Space'
      ? actionButton
      : Array.from(moveButtons).find((button) => button.dataset.clawMove === code)
    target?.classList.toggle('is-pressed', active)
  }

  const clearKeyIndicators = () => {
    actionButton.classList.remove('is-pressed')
    moveButtons.forEach((button) => button.classList.remove('is-pressed'))
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!running || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.code === 'Escape' && element.classList.contains('is-prize-panel-open')) {
      event.preventDefault()
      setPrizePanelOpen(false)
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      setKeyIndicator(event.code, true)
      if (!event.repeat && !element.classList.contains('is-prize-panel-open')) startDrop()
      return
    }
    if (!event.code.startsWith('Arrow')) return
    event.preventDefault()
    setKeyIndicator(event.code, true)
    if (state === 'ready' && !element.classList.contains('is-prize-panel-open')) pressed.add(event.code)
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.code !== 'Space' && !event.code.startsWith('Arrow')) return
    if (running) event.preventDefault()
    setKeyIndicator(event.code, false)
    pressed.delete(event.code)
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('resize', () => {
    if (running) resize()
  })
  actionButton.addEventListener('click', startDrop)
  actionButton.addEventListener('pointerdown', () => actionButton.classList.add('is-pressed'))
  actionButton.addEventListener('pointerup', () => actionButton.classList.remove('is-pressed'))
  actionButton.addEventListener('pointercancel', () => actionButton.classList.remove('is-pressed'))
  prizeButton.addEventListener('click', () => {
    setPrizePanelOpen(!element.classList.contains('is-prize-panel-open'))
  })
  prizePanelClose.addEventListener('click', () => setPrizePanelOpen(false))
  viewerClose.addEventListener('click', closeCollectionViewer)
  moveButtons.forEach((button) => {
    const code = button.dataset.clawMove!
    const stop = (event: PointerEvent) => {
      event.preventDefault()
      pressed.delete(code)
      button.classList.remove('is-pressed')
    }
    button.addEventListener('pointerdown', (event) => {
      if (!running || state !== 'ready' || element.classList.contains('is-prize-panel-open')) return
      event.preventDefault()
      button.setPointerCapture(event.pointerId)
      pressed.add(code)
      button.classList.add('is-pressed')
    })
    button.addEventListener('pointerup', stop)
    button.addEventListener('pointercancel', stop)
    button.addEventListener('lostpointercapture', () => pressed.delete(code))
  })
  window.addEventListener('blur', () => {
    pressed.clear()
    clearKeyIndicators()
  })

  return {
    start() {
      initialize()
      running = true
      if (orbit) orbit.enabled = true
      pressed.clear()
      clock.start()
      resize()
      cancelAnimationFrame(frame)
      animate()
    },
    stop() {
      running = false
      clock.stop()
      if (orbit) orbit.enabled = false
      pressed.clear()
      clearKeyIndicators()
      cancelAnimationFrame(frame)
    },
    resize,
  }
}
