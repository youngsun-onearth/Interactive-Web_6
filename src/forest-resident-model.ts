import * as THREE from 'three'
import type { BodyPoint, ImageMask, ResidentAnalysis } from './forest-resident-types'
import { normalizeSubjectMask } from './forest-subject-mask'
import { createResidentOutfit } from './forest-resident-outfit'

type Box = { left: number; right: number; top: number; bottom: number }
type Region = { corners: [number, number][] }
export type ResidentModel = { group: THREE.Group; limbs: THREE.Group[]; head: THREE.Group | null; height: number; label: string; fingerprint: number; mappedParts: string[]; dispose: () => void }
export function configureResidentMaterial(mat: THREE.MeshStandardMaterial, part: string) {
  mat.userData.residentPart = part
  if (part === 'whole' || part === 'skin' || mat.map?.userData.residentTextureSource === 'wardrobe') return
  mat.customProgramCacheKey = () => part === 'face' ? 'resident-face-only-v1' : 'resident-photo-front-v1'
  mat.onBeforeCompile = shader => {
    const avg = (part === 'face' ? mat.map?.userData.skinColor : mat.map?.userData.average) as number[] ?? [160, 140, 110]
    shader.uniforms.residentBack = { value: new THREE.Color().setRGB(avg[0] / 255, avg[1] / 255, avg[2] / 255, THREE.SRGBColorSpace) }
    shader.vertexShader = 'varying float residentFront;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nresidentFront = normal.z;')
    const blend = part === 'face' ? 'smoothstep(.25, .72, residentFront)' : 'smoothstep(-.15, .45, residentFront)'
    shader.fragmentShader = 'varying float residentFront;\nuniform vec3 residentBack;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb = mix(residentBack, diffuseColor.rgb, ${blend});`)
  }
}
const clamp = THREE.MathUtils.clamp
function bounds(mask: ImageMask): Box {
  let left = mask.width; let right = 0; let top = mask.height; let bottom = 0
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.values[y * mask.width + x] > 127) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  return { left: left / mask.width, right: (right + 1) / mask.width, top: top / mask.height, bottom: (bottom + 1) / mask.height }
}
const rectangle = (x: number, y: number, w: number, h: number): Region => ({ corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] })
function pointAvailable(p: BodyPoint | undefined) { return p && (p.visibility ?? 1) > .45 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 }
function textureRegions(pose: BodyPoint[], box: Box, imageAspect: number) {
  const w = box.right - box.left; const h = box.bottom - box.top
  const regions: Record<string, Region> = { whole: rectangle(box.left, box.top, w, h), body: rectangle(box.left + w * .22, box.top + h * .3, w * .56, h * .5) }
  const mapped: string[] = []
  const hasEyes = pointAvailable(pose[2]) && pointAvailable(pose[5])
  const hasEars = pointAvailable(pose[7]) && pointAvailable(pose[8])
  if (pointAvailable(pose[0]) && (hasEyes || hasEars)) {
    const nose = pose[0]
    // Crop to the face itself, without the old 60% ear-span margin or body-width
    // minimum that made faces tiny when the person's arms were spread out.
    const eyeSpan = hasEyes ? Math.abs(pose[2].x - pose[5].x) : 0
    const earSpan = hasEars ? Math.abs(pose[7].x - pose[8].x) : 0
    const width = Math.max(earSpan, eyeSpan * 2.1, .015)
    const hasMouth = pointAvailable(pose[9]) && pointAvailable(pose[10])
    const eyeY = hasEyes ? (pose[2].y + pose[5].y) * .5 : nose.y
    const mouthY = hasMouth ? (pose[9].y + pose[10].y) * .5 : nose.y
    // Landmark x/y use different image dimensions; preserve the crop's physical aspect.
    const height = Math.max(width * imageAspect * 1.22, Math.abs(mouthY - eyeY) * 2.6)
    const centerX = hasEyes ? (pose[2].x + pose[5].x) * .4 + nose.x * .2 : (pose[7].x + pose[8].x) * .4 + nose.x * .2
    const centerY = hasEyes && hasMouth ? eyeY * .45 + mouthY * .55 : nose.y - height * .04
    regions.head = rectangle(centerX - width * .5, centerY - height * .5, width, height); mapped.push('face')
  } else regions.head = rectangle(box.left + w * .30, box.top, w * .40, h * .23)
  if ([11, 12, 23, 24].every(i => pointAvailable(pose[i]))) {
    const shoulders = [pose[11], pose[12]].sort((a, b) => a.x - b.x); const hips = [pose[23], pose[24]].sort((a, b) => a.x - b.x)
    regions.body = { corners: [[shoulders[0].x, shoulders[0].y], [shoulders[1].x, shoulders[1].y], [hips[1].x, hips[1].y], [hips[0].x, hips[0].y]] }; mapped.push('torso')
  }
  for (const [name, first, second, thickness] of [['leftArm', 11, 15, .10], ['rightArm', 12, 16, .10], ['leftLeg', 23, 27, .13], ['rightLeg', 24, 28, .13]] as const) {
    if (pointAvailable(pose[first]) && pointAvailable(pose[second])) {
      const a = pose[first]; const b = pose[second]; const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.max(.001, Math.hypot(dx, dy)); const r = w * thickness
      const nx = -dy / length * r; const ny = dx / length * r
      regions[name] = { corners: [[a.x + nx, a.y + ny], [a.x - nx, a.y - ny], [b.x - nx, b.y - ny], [b.x + nx, b.y + ny]] }; mapped.push(name)
    } else regions[name] = regions.body
  }
  return { regions, mapped }
}
function makePersonTextures(photo: HTMLCanvasElement, analysis: ResidentAnalysis, faceOnly = false) {
  const ctx = photo.getContext('2d')!; const pixels = ctx.getImageData(0, 0, photo.width, photo.height).data
  const mask = analysis.person; const box = bounds(mask); const { regions, mapped } = textureRegions(analysis.pose, box, photo.width / photo.height)
  if (faceOnly && !mapped.includes('face')) throw new Error('얼굴을 찾지 못했어요. 카메라에 얼굴 전체가 보이도록 다시 촬영해 주세요.')
  const inside = (u: number, v: number) => {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false
    return mask.values[Math.floor(v * mask.height) * mask.width + Math.floor(u * mask.width)] > 160
  }
  const average = [0, 0, 0]; let total = 0
  for (let y = 0; y < photo.height; y += 4) for (let x = 0; x < photo.width; x += 4) if (inside(x / photo.width, y / photo.height)) {
    const i = (y * photo.width + x) * 4
    for (let c = 0; c < 3; c++) average[c] += pixels[i + c]
    total++
  }
  if (!total) throw new Error('사진에서 사용할 사람 텍스처를 찾지 못했어요. 다시 촬영해 주세요.')
  average.forEach((v, i) => { average[i] = v / total })
  const textures: Record<string, THREE.CanvasTexture> = {}
  for (const [name, region] of Object.entries(regions)) {
    if (faceOnly && name !== 'head') continue
    const size = name === 'head' ? 512 : 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
    const context = canvas.getContext('2d')!; const data = context.createImageData(size, size); const valid = new Uint8Array(size * size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / (size - 1); const v = y / (size - 1); const [a, b, c, d] = region.corners
      const sx = (a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v
      const sy = (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v
      const index = y * size + x; const foreground = inside(sx, sy); valid[index] = foreground ? 1 : 0
      const source = (Math.floor(clamp(sy, 0, .99999) * photo.height) * photo.width + Math.floor(clamp(sx, 0, .99999) * photo.width)) * 4
      for (let channel = 0; channel < 3; channel++) data.data[index * 4 + channel] = foreground ? pixels[source + channel] : average[channel]
      data.data[index * 4 + 3] = 255
    }
    // Pad UV seams with nearest foreground pixels only; camera background never enters an atlas.
    const queue = new Int32Array(size * size); const paddingDistance = new Uint16Array(size * size); let head = 0; let tail = 0
    const partAverage = [0, 0, 0]; let partCount = 0
    const cheeks: number[][] = [[], [], []]
    for (let i = 0; i < valid.length; i++) if (valid[i]) { partCount++; for (let c = 0; c < 3; c++) partAverage[c] += data.data[i * 4 + c] }
    if (faceOnly) for (let y = Math.floor(size * .48); y < size * .72; y++) for (let x = Math.floor(size * .2); x < size * .8; x++) {
      if (x > size * .38 && x < size * .62) continue
      const i = y * size + x; const r = data.data[i * 4]; const g = data.data[i * 4 + 1]; const b = data.data[i * 4 + 2]
      if (valid[i] && r > 25 && r < 248 && r >= g * .95 && r >= b) { cheeks[0].push(r); cheeks[1].push(g); cheeks[2].push(b) }
    }
    partAverage.forEach((v, i) => { partAverage[i] = partCount ? v / partCount : average[i] })
    for (let i = 0; i < valid.length; i++) if (valid[i]) queue[tail++] = i
    while (head < tail) {
      const i = queue[head++]; const x = i % size
      for (const j of [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size]) {
        if (j < 0 || j >= valid.length || valid[j]) continue
        valid[j] = 1; queue[tail++] = j; paddingDistance[j] = paddingDistance[i] + 1
        for (let c = 0; c < 3; c++) data.data[j * 4 + c] = data.data[i * 4 + c]
      }
    }
    // Fade extended edges into the same body part's sampled color instead of stretching
    // single scanlines into stripes on ears, cheeks, or the back of a rounded limb.
    for (let i = 0; i < valid.length; i++) if (paddingDistance[i]) {
      const weight = Math.exp(-paddingDistance[i] / 9)
      for (let c = 0; c < 3; c++) data.data[i * 4 + c] = data.data[i * 4 + c] * weight + partAverage[c] * (1 - weight)
    }
    context.putImageData(data, 0, 0)
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.userData.average = partAverage
    if (faceOnly) {
      texture.userData.residentTextureSource = 'camera-face'
      texture.userData.skinColor = cheeks[0].length > 20 ? cheeks.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]) : partAverage
    }
    textures[name] = texture
  }
  return { textures, mapped: faceOnly ? ['face'] : mapped }
}
function silhouetteMetrics(mask: ImageMask) {
  const box = bounds(mask); const profiles: { left: number; right: number; width: number }[] = []
  const w = Math.max(.001, box.right - box.left); const h = Math.max(.001, box.bottom - box.top)
  for (let row = 0; row < 32; row++) {
    const y = clamp(Math.floor((box.top + (row + .5) / 32 * h) * mask.height), 0, mask.height - 1)
    let left = mask.width; let right = 0
    for (let x = 0; x < mask.width; x++) if (mask.values[y * mask.width + x] > 127) { left = Math.min(left, x); right = Math.max(right, x) }
    profiles.push({ left: (left / mask.width - box.left) / w, right: (right / mask.width - box.left) / w, width: Math.max(0, (right - left) / mask.width / w) })
  }
  let fingerprint = 2166136261
  for (let i = 0; i < mask.values.length; i += 17) fingerprint = Math.imul(fingerprint ^ mask.values[i], 16777619) >>> 0
  return { box, profiles, ratio: w * mask.width / (h * mask.height), fingerprint }
}
function species(analysis: ResidentAnalysis) {
  const top = analysis.categories[0]; const label = top?.name.toLowerCase() ?? ''; const index = top?.index ?? -1
  // EfficientNet's 1,000 ImageNet labels. Unknown shapes retain their actual segmented contour.
  if (/rabbit|hare|wood rabbit/.test(label)) return { kind: 'rabbit', label: '토끼를 닮은 이웃' }
  if (/cat|tabby|lynx|tiger|lion|leopard|cheetah|cougar|jaguar|siamese/.test(label)) return { kind: 'cat', label: '고양이를 닮은 이웃' }
  if (/fox|wolf|coyote/.test(label)) return { kind: 'fox', label: '숲속 여우 이웃' }
  if (index >= 151 && index <= 268 || /dog|terrier|retriever|poodle|spaniel|collie|husky|hound|corgi/.test(label)) return { kind: 'dog', label: '강아지를 닮은 이웃' }
  if (/bear|panda|koala/.test(label)) return { kind: 'bear', label: '곰을 닮은 이웃' }
  if (/squirrel|hamster|mouse|marmot|beaver|porcupine/.test(label)) return { kind: 'mouse', label: '작은 숲의 이웃' }
  if (/bird|duck|goose|drake|penguin|hen|cock|robin|finch|parrot|macaw|owl|flamingo|ostrich|jay|magpie|toucan|eagle|vulture|swan/.test(label)) return { kind: 'bird', label: '새를 닮은 이웃' }
  if (/frog|toad/.test(label)) return { kind: 'frog', label: '개구리를 닮은 이웃' }
  if (/elephant|tusker/.test(label)) return { kind: 'elephant', label: '코끼리를 닮은 이웃' }
  if (/sheep|ram|ox|cow|bison|goat|ibex|deer|gazelle|antelope/.test(label)) return { kind: 'horned', label: '들판에서 온 이웃' }
  // The uploaded reference must contain both a face and shoulders. Camera
  // landmarks (analysis.pose) and uncertain shoulder-only detections must never
  // turn an unrecognized object into the default person-shaped resident.
  const pose = analysis.referencePose
  if ([0, 2, 5, 11, 12].every(i => pointAvailable(pose[i]) && (pose[i].visibility ?? 1) >= .65)
    && Math.abs(pose[2].x - pose[5].x) > .008 && Math.abs(pose[11].x - pose[12].x) > .035
    && pose[0].y < (pose[11].y + pose[12].y) / 2) return { kind: 'person', label: '나를 닮은 작은 이웃' }
  return { kind: 'silhouette', label: '세상에 하나뿐인 이웃' }
}

// Inflate the actual foreground contour into a closed, rounded mesh. No billboard or stock model.
function inflatedSilhouette(mask: ImageMask, box: Box) {
  const n = 72; const inside = new Uint8Array(n * n); const distance = new Float32Array(n * n)
  const aspect = (box.right - box.left) * mask.width / ((box.bottom - box.top) * mask.height)
  const width = clamp(aspect * 1.7, .75, 2.1); const height = 1.9
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = box.left + x / (n - 1) * (box.right - box.left); const v = box.top + y / (n - 1) * (box.bottom - box.top)
    const foreground = mask.values[Math.min(mask.height - 1, Math.floor(v * mask.height)) * mask.width + Math.min(mask.width - 1, Math.floor(u * mask.width))] > 127
    const i = y * n + x; inside[i] = foreground ? 1 : 0; distance[i] = foreground ? 100 : 0
    if (x === 0 || x === n - 1 || y === 0 || y === n - 1) distance[i] = 0
  }
  for (let y = 1; y < n; y++) for (let x = 1; x < n; x++) { const i = y * n + x; distance[i] = Math.min(distance[i], distance[i - 1] + 1, distance[i - n] + 1) }
  for (let y = n - 2; y >= 0; y--) for (let x = n - 2; x >= 0; x--) { const i = y * n + x; distance[i] = Math.min(distance[i], distance[i + 1] + 1, distance[i + n] + 1) }
  const positions: number[] = []; const uvs: number[] = []; const indices: number[] = []
  for (let side = 0; side < 2; side++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / (n - 1); const v = y / (n - 1)
    // Shorten the lower portion and enlarge the upper silhouette to harmonize the miniature proportions.
    const miniatureY = Math.pow(1 - v, .82)
    positions.push((u - .5) * width * (1 + (1 - v) * .12), miniatureY * height + .06, (side === 0 ? 1 : -1) * (.055 + Math.sqrt(Math.min(1, distance[y * n + x] / 14)) * .33))
    uvs.push(u, 1 - v)
  }
  const cells = new Uint8Array((n - 1) * (n - 1))
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x
    if (inside[a] + inside[a + 1] + inside[a + n] + inside[a + n + 1] < 3) continue
    cells[y * (n - 1) + x] = 1
    const b = a + 1; const c = a + n; const d = c + 1; const back = n * n
    indices.push(a, c, b, b, c, d, a + back, b + back, c + back, b + back, d + back, c + back)
  }
  const cell = (x: number, y: number) => x >= 0 && y >= 0 && x < n - 1 && y < n - 1 && cells[y * (n - 1) + x]
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (cell(x, y)) {
    const a = y * n + x; const b = a + 1; const c = a + n; const d = c + 1; const back = n * n
    for (const [visible, first, second] of [[!cell(x, y - 1), b, a], [!cell(x + 1, y), d, b], [!cell(x, y + 1), c, d], [!cell(x - 1, y), a, c]] as [boolean, number, number][]) if (visible) indices.push(first, first + back, second, second, first + back, second + back)
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry
}
export function buildResident(photo: HTMLCanvasElement, analysis: ResidentAnalysis): ResidentModel {
  analysis = { ...analysis, reference: normalizeSubjectMask(analysis.reference) }
  const identity = species(analysis); const isPerson = identity.kind === 'person'
  const { textures, mapped } = makePersonTextures(photo, analysis, isPerson); const metrics = silhouetteMetrics(analysis.reference)
  const group = new THREE.Group(); const limbs: THREE.Group[] = []; let head: THREE.Group | null = null
  if (isPerson) {
    const outfit = createResidentOutfit(); Object.assign(textures, outfit.textures)
    group.userData.appearance = { version: 1, ...outfit.appearance }
  }
  const materials: THREE.MeshStandardMaterial[] = []; const geometries: THREE.BufferGeometry[] = []
  function material(part: string) {
    const map = textures[part] ?? textures.body
    const mat = new THREE.MeshStandardMaterial({ map, roughness: .87 })
    configureResidentMaterial(mat, isPerson && part === 'head' ? 'face' : part)
    materials.push(mat); return mat
  }
  const skin = material('head'); const bodyMat = material('body')
  let plainSkin = skin
  if (isPerson) {
    const rgb = textures.head.userData.skinColor as number[]
    plainSkin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace), roughness: .87 })
    configureResidentMaterial(plainSkin, 'skin'); materials.push(plainSkin)
  }
  const sphere = new THREE.SphereGeometry(1, 32, 24)
  // Front-project the atlas, blending around the sides through padded foreground pixels.
  const uv = sphere.getAttribute('uv'); const positions = sphere.getAttribute('position')
  for (let i = 0; i < positions.count; i++) uv.setXY(i, clamp(positions.getX(i) * .5 + .5, .02, .98), clamp(positions.getY(i) * .5 + .5, .02, .98))
  geometries.push(sphere)
  function ellipsoid(parent: THREE.Group, xyz: number[], size: number[], mat: THREE.Material) {
    const mesh = new THREE.Mesh(sphere, mat); mesh.position.set(xyz[0], xyz[1], xyz[2]); mesh.scale.set(size[0], size[1], size[2]); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  if (identity.kind === 'silhouette') {
    const geometry = inflatedSilhouette(analysis.reference, metrics.box); geometries.push(geometry)
    const shape = new THREE.Mesh(geometry, material('whole')); shape.castShadow = true; shape.receiveShadow = true; group.add(shape)
  } else {
    const upper = metrics.profiles.slice(3, 14).reduce((sum, row) => sum + row.width, 0) / 11
    const lower = metrics.profiles.slice(16, 26).reduce((sum, row) => sum + row.width, 0) / 10
    const headWidth = clamp(.46 + upper * .16 + (metrics.ratio - .7) * .08, .46, .70)
    const bodyWidth = clamp(.25 + lower * .14, .27, .43)
    const headHeight = identity.kind === 'frog' ? .39 : .49 + (metrics.fingerprint % 19) / 220
    ellipsoid(group, [0, .79, 0], [bodyWidth, .44, .29], bodyMat)
    head = new THREE.Group(); head.position.y = 1.45; group.add(head)
    ellipsoid(head, [0, 0, 0], [headWidth, headHeight, .45], skin)
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
      const leg = new THREE.Group(); leg.position.set(sign * .16, .40, 0); group.add(leg); limbs.push(leg)
      ellipsoid(leg, [0, -.15, 0], [.12, .22, .13], material(`${side}Leg`)); ellipsoid(leg, [0, -.28, .06], [.13, .085, .18], material(isPerson ? 'shoes' : `${side}Leg`))
      const arm = new THREE.Group(); arm.position.set(sign * (bodyWidth + .015), 1.02, 0); arm.rotation.z = sign * .17; group.add(arm); limbs.push(arm)
      ellipsoid(arm, [sign * .025, isPerson ? -.13 : -.18, 0], [.115, isPerson ? .21 : .27, .13], material(`${side}Arm`))
      if (isPerson) ellipsoid(arm, [sign * .025, -.36, .015], [.095, .115, .10], plainSkin)
    }
    if (['cat', 'fox', 'rabbit', 'dog', 'bear', 'mouse', 'horned'].includes(identity.kind)) {
      for (const sign of [-1, 1]) {
        const ear = new THREE.Group(); ear.position.set(sign * headWidth * .70, headHeight * .67, -.025); ear.rotation.z = -sign * .23; head.add(ear)
        if (identity.kind === 'cat' || identity.kind === 'fox') {
          const geometry = new THREE.ConeGeometry(.20, .44, 3, 1); geometries.push(geometry)
          const mesh = new THREE.Mesh(geometry, skin); mesh.position.y = .12; mesh.rotation.y = Math.PI / 6; mesh.scale.z = .65; mesh.castShadow = true; ear.add(mesh)
        } else if (identity.kind === 'rabbit') ellipsoid(ear, [0, .28, 0], [.14, .43, .11], skin)
        else if (identity.kind === 'dog') { ear.position.y = .13; ear.position.x = sign * headWidth * .96; ear.rotation.z = sign * .14; ellipsoid(ear, [0, -.14, 0], [.18, .32, .12], skin) }
        else ellipsoid(ear, [0, .055, 0], [identity.kind === 'mouse' ? .27 : .21, .23, .13], skin)
      }
    }
    if (['dog', 'bear', 'fox', 'horned'].includes(identity.kind)) ellipsoid(head, [0, -.16, .40], [identity.kind === 'fox' ? .20 : .27, .18, identity.kind === 'fox' ? .31 : .17], skin)
    if (identity.kind === 'bird') ellipsoid(head, [0, -.13, .46], [.26, .10, .28], skin)
    if (identity.kind === 'frog') for (const sign of [-1, 1]) ellipsoid(head, [sign * headWidth * .65, .33, .04], [.19, .22, .19], skin)
    if (identity.kind === 'elephant') {
      for (const sign of [-1, 1]) ellipsoid(head, [sign * .58, .03, -.03], [.33, .40, .105], skin)
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.06, .40), new THREE.Vector3(0, -.30, .53), new THREE.Vector3(0, -.53, .57), new THREE.Vector3(0, -.48, .72)])
      const geometry = new THREE.TubeGeometry(path, 14, .09, 10, false); geometries.push(geometry); const trunk = new THREE.Mesh(geometry, skin); trunk.castShadow = true; head.add(trunk)
    }
    if (identity.kind === 'horned') for (const sign of [-1, 1]) {
      const geometry = new THREE.ConeGeometry(.065, .28, 12); geometries.push(geometry); const horn = new THREE.Mesh(geometry, skin); horn.position.set(sign * .28, .59, 0); horn.rotation.z = -sign * .3; head.add(horn)
    }
    if (['cat', 'fox', 'dog', 'mouse'].includes(identity.kind)) {
      const curl = identity.kind === 'fox' ? .35 : .18
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .56, -.2), new THREE.Vector3(.2, .65, -.5), new THREE.Vector3(.37, .98, -.53), new THREE.Vector3(.29, 1.15, -.44)])
      const geometry = new THREE.TubeGeometry(path, 16, curl, 10, false); geometries.push(geometry); const tail = new THREE.Mesh(geometry, bodyMat); tail.scale.setScalar(.75); tail.castShadow = true; group.add(tail)
    }
    if (identity.kind === 'person') {
      for (const sign of [-1, 1]) ellipsoid(head, [sign * headWidth, 0, 0], [.09, .14, .095], plainSkin)
    }
  }
  const height = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).y
  group.userData.kind = identity.kind
  return { group, limbs, head, height, label: identity.label, fingerprint: metrics.fingerprint, mappedParts: identity.kind === 'silhouette' ? [] : mapped,
    dispose() { new Set(geometries).forEach(g => g.dispose()); materials.forEach(m => m.dispose()); new Set(Object.values(textures)).forEach(t => t.dispose()) },
  }
}
