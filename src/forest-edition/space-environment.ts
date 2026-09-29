import * as THREE from 'three'

const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)

/** A small, friendly solar neighbourhood. Everything is native 3D, including the sky. */
export function createSpaceEnvironment(scene: THREE.Scene, world: THREE.Group, camera: THREE.PerspectiveCamera) {
  const sky = new THREE.Group(); sky.name = '반짝이는 우주'; scene.add(sky)
  let seed = 150924
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
  const range = (a: number, b: number) => a + random() * (b - a)
  const direction = () => {
    const y = range(-1, 1), a = range(0, TAU), r = Math.sqrt(1 - y * y)
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
  }
  const positions: number[] = [], colors: number[] = [], phases: number[] = [], sizes: number[] = []
  const palette = ['#d8faff', '#fff2ba', '#e4ceff', '#ffcbdc', '#ffffff']
  for (let i = 0; i < 2200; i++) {
    const p = direction().multiplyScalar(range(65, 92)); positions.push(p.x, p.y, p.z)
    const color = new THREE.Color(palette[i % palette.length]); colors.push(color.r, color.g, color.b)
    phases.push(range(0, TAU)); sizes.push(i % 13 === 0 ? range(8, 13) : range(2.5, 5.5))
  }
  const starsGeometry = new THREE.BufferGeometry()
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  starsGeometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1))
  starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))
  const starsMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float phase; attribute float size; uniform float time; uniform float pixelRatio;
      varying vec3 tint; varying float glow;
      void main() { tint = color; glow = .72 + .25 * sin(time * .7 + phase);
        vec4 p = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * p;
        gl_PointSize = size * pixelRatio * clamp(75. / -p.z, .7, 1.8); }`,
    fragmentShader: `varying vec3 tint; varying float glow;
      void main() { vec2 p = abs(gl_PointCoord - .5) * 2.;
        float core = 1. - smoothstep(.08, .65, length(p));
        float rays = (1. - smoothstep(.025, .11, min(p.x, p.y))) * pow(1. - max(p.x,p.y), .7);
        gl_FragColor = vec4(tint, max(core, rays) * glow); }`,
  })
  const stars = new THREE.Points(starsGeometry, starsMaterial); stars.name = '별빛'; sky.add(stars)

  const cloudRoot = new THREE.Group(); cloudRoot.name = '행성을 감싸는 구름'; world.add(cloudRoot)
  const cloudGeometry = new THREE.SphereGeometry(1, 10, 7)
  const clouds: { anchor: THREE.Group; latitude: number; longitude: number; speed: number; radius: number; material: THREE.MeshStandardMaterial }[] = []
  for (let i = 0; i < 13; i++) {
    const material = new THREE.MeshStandardMaterial({ color: '#eef6fb', roughness: 1, transparent: true, opacity: .86, depthWrite: false })
    const anchor = new THREE.Group(); cloudRoot.add(anchor)
    const count = 4 + Math.floor(random() * 3)
    for (let k = 0; k < count; k++) {
      const puff = new THREE.Mesh(cloudGeometry, material)
      puff.position.set((k - (count - 1) / 2) * .21, Math.sin(k / (count - 1) * Math.PI) * .08, range(-.09, .09))
      puff.scale.set(range(.21, .34), range(.09, .18), range(.19, .31)); anchor.add(puff)
    }
    clouds.push({ anchor, latitude: Math.asin(range(-.88, .88)), longitude: i * TAU / 13, speed: range(.016, .026), radius: range(7, 7.3), material })
  }

  const asteroidGeometry = new THREE.IcosahedronGeometry(1, 1)
  const vertices = asteroidGeometry.getAttribute('position')
  for (let i = 0; i < vertices.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(vertices, i)
    const roughness = 1 + Math.sin(p.x * 8 + p.z * 3) * .12 + Math.cos(p.y * 11 - p.z * 5) * .07
    p.multiplyScalar(roughness); vertices.setXYZ(i, p.x, p.y, p.z)
  }
  asteroidGeometry.computeVertexNormals()
  const asteroids: { group: THREE.Group; origin: THREE.Vector3; velocity: THREE.Vector3; duration: number; age: number; spin: THREE.Vector3 }[] = []
  function resetAsteroid(asteroid: typeof asteroids[number]) {
    const closest = direction().multiplyScalar(range(8.8, 12))
    const travel = direction().cross(closest).normalize()
    asteroid.origin.copy(closest).addScaledVector(travel, -16); asteroid.velocity.copy(travel)
    asteroid.duration = range(32, 55); asteroid.age = -range(0, 15)
  }
  for (let i = 0; i < 5; i++) {
    const group = new THREE.Group(); group.name = '지나가는 소행성'; sky.add(group)
    const material = new THREE.MeshStandardMaterial({ color: ['#b7afde', '#84cccd', '#e7bbba', '#a5b8de', '#d9ccad'][i], flatShading: true, roughness: 1 })
    const stone = new THREE.Mesh(asteroidGeometry, material); group.add(stone)
    for (let k = 0; k < 5; k++) {
      const crater = new THREE.Mesh(new THREE.CircleGeometry(range(.11, .22), 7), new THREE.MeshStandardMaterial({ color: material.color.clone().multiplyScalar(.6), roughness: 1, side: THREE.DoubleSide }))
      const normal = direction(); crater.position.copy(normal).multiplyScalar(.985); crater.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal)
      group.add(crater)
    }
    group.scale.setScalar(range(.22, .43))
    const asteroid = { group, origin: new THREE.Vector3(), velocity: new THREE.Vector3(), duration: 0, age: 0, spin: direction().multiplyScalar(range(.15, .3)) }
    resetAsteroid(asteroid); asteroid.age = i < 3 ? asteroid.duration * range(.25, .65) : -i * 5; asteroids.push(asteroid)
  }

  const meteorGeometry = new THREE.CylinderGeometry(.009, .035, 1, 6, 1, true)
  const meteors = Array.from({ length: 4 }, () => {
    const group = new THREE.Group(); group.name = '별똥별'; sky.add(group); group.visible = false
    const material = new THREE.MeshBasicMaterial({ color: '#b9f8ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    const tail = new THREE.Mesh(meteorGeometry, material); tail.position.y = -.5; group.add(tail)
    const head = new THREE.Mesh(new THREE.SphereGeometry(.048, 8, 6), material); group.add(head)
    return { group, material, start: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 10, duration: 1, length: 2 }
  })
  let elapsed = 0, previous = 0, nextMeteor = 1.2, spawnCount = 0
  function spawnMeteor() {
    const meteor = meteors.find(m => m.age > m.duration)
    if (!meteor) return
    const distance = 48, halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance
    const angle = range(0, TAU)
    const rotation = camera.getWorldQuaternion(new THREE.Quaternion())
    meteor.start.set(range(-.85,.85) * halfHeight * camera.aspect, range(-.85,.85) * halfHeight, -distance).applyQuaternion(rotation).add(camera.position)
    meteor.velocity.set(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(rotation)
    meteor.group.quaternion.setFromUnitVectors(UP, meteor.velocity)
    meteor.duration = range(.9, 1.65); meteor.length = range(1.4, 2.7); meteor.age = 0; spawnCount++
  }
  function update(now: number, following: boolean, introducing: boolean) {
    const dt = previous ? Math.min(.05, Math.max(0, (now - previous) / 1000)) : 0; previous = now; elapsed += dt
    starsMaterial.uniforms.time.value = elapsed
    stars.rotation.y = elapsed * .002
    for (const cloud of clouds) {
      const longitude = cloud.longitude + elapsed * cloud.speed
      const normal = new THREE.Vector3(Math.cos(cloud.latitude) * Math.sin(longitude), Math.sin(cloud.latitude), Math.cos(cloud.latitude) * Math.cos(longitude))
      cloud.anchor.position.copy(normal).multiplyScalar(cloud.radius); cloud.anchor.quaternion.setFromUnitVectors(UP, normal)
      cloud.material.opacity = THREE.MathUtils.damp(cloud.material.opacity, following ? .09 : .86, 6, dt)
    }
    for (const asteroid of asteroids) {
      asteroid.age += dt
      if (asteroid.age > asteroid.duration) resetAsteroid(asteroid)
      asteroid.group.visible = asteroid.age >= 0 && !introducing
      asteroid.group.position.copy(asteroid.origin).addScaledVector(asteroid.velocity, Math.max(0, asteroid.age) / asteroid.duration * 32)
      asteroid.group.rotation.x += asteroid.spin.x * dt; asteroid.group.rotation.y += asteroid.spin.y * dt; asteroid.group.rotation.z += asteroid.spin.z * dt
    }
    nextMeteor -= dt
    if (nextMeteor <= 0) { spawnMeteor(); nextMeteor = range(1.8, 4.5) }
    for (const meteor of meteors) {
      meteor.age += dt; const t = meteor.age / meteor.duration
      meteor.group.visible = t < 1 && !introducing
      if (!meteor.group.visible) continue
      meteor.group.position.copy(meteor.start).addScaledVector(meteor.velocity, t * 12)
      meteor.group.scale.y = meteor.length * (.5 + .5 * Math.sin(t * Math.PI))
      meteor.material.opacity = Math.sin(t * Math.PI) * .9
    }
  }
  update(0, false, false)
  return { update, resetClock() { previous = 0 }, get meteorCount() { return spawnCount } }
}
