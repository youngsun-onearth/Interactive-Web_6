import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Hand-built volumes: the reference's silhouettes, markings and low-poly finish. */
export const wildlifeSpecies = ['crab', 'monkey', 'toad', 'penguin', 'pigeon', 'siamese', 'rat', 'shark', 'duck', 'dog', 'sheep', 'goldfish', 'riverfish', 'chicken', 'calico', 'frog'] as const
export type WildlifeSpecies = typeof wildlifeSpecies[number]
export const wildlifeNames: Record<WildlifeSpecies, string> = {
  crab: '꽃게', monkey: '원숭이', toad: '두꺼비', penguin: '펭귄', pigeon: '비둘기', siamese: '샴고양이', rat: '생쥐', shark: '상어',
  duck: '오리', dog: '분홍 강아지', sheep: '양', goldfish: '금붕어', riverfish: '열대어', chicken: '닭', calico: '삼색고양이', frog: '개구리',
}
type XYZ = [number, number, number]
type Joint = { object: THREE.Group; axis: 'x' | 'y' | 'z'; phase: number; amount: number; rest: number }
const sphere = new THREE.SphereGeometry(1, 10, 8)
const box = new THREE.BoxGeometry(1, 1, 1)
const cone = new THREE.ConeGeometry(1, 1, 5)
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 6)
const materials = new Map<string, THREE.MeshStandardMaterial>()
const batchedMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, roughness: .92 })
function batchRigidParts(root: THREE.Group) {
  const groups: THREE.Object3D[] = []; root.traverse(object => { if (!(object instanceof THREE.Mesh)) groups.push(object) })
  for (const parent of groups) {
    const parts = parent.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> => child instanceof THREE.Mesh)
    if (parts.length < 2) continue
    const geometries = parts.map(part => {
      part.updateMatrix()
      const geometry = part.geometry.clone().applyMatrix4(part.matrix)
      // These models have no image maps. Bake the same linear material colors
      // into vertices, retaining all original triangles and the animated joints.
      geometry.deleteAttribute('uv')
      const colors = new Float32Array(geometry.getAttribute('position').count * 3), color = part.material.color
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return geometry
    })
    const merged = mergeGeometries(geometries)
    geometries.forEach(geometry => geometry.dispose())
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, batchedMaterial); mesh.castShadow = true; mesh.receiveShadow = true
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false
    parent.add(mesh)
    for (const part of parts) {
      part.removeFromParent()
      if (![sphere, box, cone, cylinder].includes(part.geometry as typeof sphere)) part.geometry.dispose()
    }
  }
}
function material(color: string) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: .92 }))
  return materials.get(color)!
}
export function createWildlifeModel(species: WildlifeSpecies) {
  const group = new THREE.Group(); group.name = wildlifeNames[species]; group.userData.species = species
  const joints: Joint[] = []
  const add = (geometry: THREE.BufferGeometry, color: string, position: XYZ, scale: XYZ, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material(color)); mesh.position.set(...position); mesh.scale.set(...scale)
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  const ball = (color: string, p: XYZ, s: XYZ, parent: THREE.Object3D = group) => add(sphere, color, p, s, parent)
  const cube = (color: string, p: XYZ, s: XYZ, parent: THREE.Object3D = group) => add(box, color, p, s, parent)
  const point = (color: string, p: XYZ, s: XYZ, parent: THREE.Object3D = group) => add(cone, color, p, s, parent)
  const joint = (p: XYZ, axis: Joint['axis'], phase: number, amount: number, parent: THREE.Object3D = group) => {
    const object = new THREE.Group(); object.position.set(...p); parent.add(object)
    joints.push({ object, axis, phase, amount, rest: 0 }); return object
  }
  const rod = (color: string, a: XYZ, b: XYZ, width: number, parent: THREE.Object3D = group) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from)
    const mesh = add(cylinder, color, from.clone().add(to).multiplyScalar(.5).toArray() as XYZ, [width, delta.length(), width], parent)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh
  }
  const fin = (color: string, vertices: XYZ[], parent: THREE.Object3D = group, thickness = .035) => {
    // A closed triangular prism gives every fin a silhouette from either side.
    const a = new THREE.Vector3(...vertices[0]), b = new THREE.Vector3(...vertices[1]), c = new THREE.Vector3(...vertices[2])
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize().multiplyScalar(thickness / 2)
    const points = [...[a,b,c].map(v => v.clone().add(n)), ...[a,b,c].map(v => v.clone().sub(n))]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    geo.setIndex([0,1,2,5,4,3,0,3,4,0,4,1,1,4,5,1,5,2,2,5,3,2,3,0]); geo.computeVertexNormals()
    return add(geo, color, [0,0,0], [1,1,1], parent)
  }
  const eyes = (x: number, y: number, z: number, radius = .085, iris = '#242724', parent: THREE.Object3D = group) => {
    for (const side of [-1,1]) {
      ball('#fffbed', [side*x,y,z], [radius*1.25,radius*1.35,radius*.5], parent)
      ball(iris, [side*x,y,z+radius*.36], [radius*.76,radius*.91,radius*.36], parent)
      ball('#ffffff', [side*x-radius*.2,y+radius*.32,z+radius*.65], [radius*.21,radius*.25,radius*.15], parent)
    }
  }
  const legs = (color: string, x: number, z: number, height: number, width: number, feet = color) => {
    for (const side of [-1,1]) for (const end of [-1,1]) {
      const leg = joint([side*x,height,end*z], 'x', side*end > 0 ? 0 : Math.PI, .34)
      ball(color, [0,-height*.44,0], [width,height*.6,width], leg)
      ball(feet, [0,-height+.065,.055], [width*1.13,.09,width*1.45], leg)
    }
  }
  if (species === 'siamese' || species === 'calico' || species === 'dog' || species === 'sheep') {
    const cat = species === 'siamese' || species === 'calico', wool = species === 'sheep', dog = species === 'dog'
    const base = species === 'siamese' ? '#eadfb7' : dog ? '#efa1a5' : '#f4f2dd'
    const dark = species === 'siamese' ? '#514839' : wool ? '#343432' : dog ? '#c8737b' : '#eeeadd'
    ball(base, [0,.62,-.12], [.39,.38,.57]); legs(base,.24,.35,.43,.105, species === 'siamese' ? dark : base)
    if (wool) {
      for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI*2
        ball(i%3 ? '#f4f1df' : '#d8e6e4', [Math.cos(a)*.32,.67+Math.sin(a)*.29,(ring-1)*.31-.13], [.22,.22,.25])
      }
      legs('#30332e',.24,.35,.28,.07)
    }
    const head = joint([0,.79,.43], 'y', 0, .055)
    ball(base, [0,0,0], [.34,.33,.31],head)
    ball(dark, [0,-.06,.19], [cat ? .26 : .28,.245,.18],head)
    if (cat) {
      for (const side of [-1,1]) {
        const ear = point(dark,[side*.24,.28,.01],[.145,.35,.11],head); ear.rotation.z = -side*.18
        fin('#c8998b', [[side*.15,.21,.105],[side*.32,.21,.105],[side*.28,.4,.105]],head)
      }
    } else for (const side of [-1,1]) {
      const ear = ball(dark,[side*.34,dog ? -.025 : .12,0],dog ? [.115,.28,.14] : [.2,.065,.13],head); ear.rotation.z = side*.38
    }
    eyes(.13,.035,.315,.066,cat ? '#6eaaad' : '#242724',head)
    ball('#383b36',[0,-.11,.373],[.068,.048,.038],head)
    for (const side of [-1,1]) rod('#53433c',[0,-.14,.365],[side*.065,-.185,.345],.012,head)
    if (dog) {
      ball('#dd6d83',[0,-.202,.352],[.038,.05,.022],head)
      // Raised heart patch on the flank, like the pink reference dog.
      const heart = new THREE.Group(); heart.position.set(.375,.71,-.26); heart.rotation.y = Math.PI/2; group.add(heart)
      ball('#d76e7b',[-.057,.03,0],[.084,.079,.02],heart); ball('#d76e7b',[.057,.03,0],[.084,.079,.02],heart)
      fin('#d76e7b',[[-.12,.025,0],[.12,.025,0],[0,-.14,0]],heart)
    }
    if (species === 'calico') {
      ball('#b47e45',[.24,.87,-.22],[.21,.16,.25]); ball('#797266',[-.25,.67,-.38],[.14,.22,.2]); ball('#b47e45',[-.18,.94,.48],[.15,.13,.21])
      const fish = new THREE.Group(); fish.position.set(0,.53,.86); fish.rotation.z = .12; group.add(fish)
      ball('#8ea8b6',[0,0,0],[.36,.075,.07],fish); fin('#647e8f',[[-.28,0,0],[-.49,.13,0],[-.49,-.13,0]],fish)
      ball('#222e34',[.24,.025,.06],[.022,.022,.013],fish)
    }
    const tail = joint([0,.79,-.62], 'z', 1, .25)
    if (wool) ball(base,[0,0,-.1],[.13,.14,.19],tail)
    else { rod(dark,[0,0,0],[0,.4,-.17],.065,tail); rod(dark,[0,.4,-.17],[.04,.58,-.1],.055,tail) }
  } else if (species === 'monkey') {
    ball('#a36836',[0,.57,0],[.29,.4,.22]); ball('#ca9657',[0,.57,.19],[.19,.25,.075])
    const head = joint([0,1.17,.06], 'y', 0, .09)
    ball('#9b5a2d',[0,0,0],[.4,.4,.32],head)
    for (const side of [-1,1]) {
      ball('#a67343',[side*.4,0,0],[.19,.22,.115],head); ball('#e3c689',[side*.42,0,.065],[.12,.15,.055],head)
      ball('#e9cc92',[side*.135,.02,.25],[.2,.235,.1],head)
      const arm = joint([side*.27,.81,0],'x',side<0?0:Math.PI,.4)
      rod('#a36836',[0,0,0],[side*.14,-.45,.07],.09,arm); ball('#e0be82',[side*.14,-.45,.07],[.12,.13,.12],arm)
      const leg = joint([side*.14,.3,0],'x',side<0?Math.PI:0,.4)
      ball('#9b5a2d',[0,-.12,0],[.105,.2,.11],leg);ball('#dac088',[0,-.24,.08],[.13,.07,.18],leg)
    }
    ball('#e3c187',[0,-.16,.28],[.27,.17,.13],head); eyes(.135,.075,.335,.06,'#35294b',head)
    rod('#654e35',[-.1,-.2,.395],[0,-.23,.405],.013,head);rod('#654e35',[0,-.23,.405],[.1,-.2,.395],.013,head)
    const tail = joint([0,.4,-.17],'z',0,.2)
    const curve = new THREE.CatmullRomCurve3([[0,0,0],[0,.2,-.45],[.18,.6,-.5],[.3,.63,-.38],[.25,.48,-.3]].map(p=>new THREE.Vector3(...p)))
    add(new THREE.TubeGeometry(curve,16,.055,5,false),'#985d31',[0,0,0],[1,1,1],tail)
  } else if (species === 'penguin' || species === 'duck' || species === 'chicken' || species === 'pigeon') {
    const penguin = species==='penguin', chicken = species==='chicken', pigeon = species==='pigeon'
    const base = penguin ? '#2531a2' : pigeon ? '#63737d' : '#ececdb', wing = penguin ? '#202795' : pigeon ? '#46535f' : '#dddcca'
    const height = penguin ? .66 : .45
    ball(base,[0,height,0],[.35,penguin?.54:.32,.38]); ball(penguin ? '#f9f6e6' : base,[0,height-.04,.21],[.29,penguin?.4:.25,.19])
    if (pigeon) ball('#407a70',[0,.85,.18],[.23,.24,.22])
    const head = joint([0,penguin ? 1.15 : .99,.2], 'y',0,.08)
    ball(base,[0,0,0],[.27,.29,.265],head)
    eyes(.12,.055,.225,.07,'#242724',head)
    const beakColor = pigeon ? '#b4a58a' : '#e8b72b'
    if (species==='duck') { ball(beakColor,[0,-.075,.33],[.23,.075,.26],head);rod('#8d762f',[-.18,-.084,.44],[.18,-.084,.44],.009,head) }
    else { const beak = point(beakColor,[0,-.055,.32],[.135,.27,.105],head);beak.rotation.x=Math.PI/2 }
    for (const side of [-1,1]) {
      const flap = joint([side*.29,height+.12,0],'z',side<0?0:Math.PI,penguin?.1:.16)
      const mesh=ball(wing,[side*.07,-.13,-.05],penguin?[.075,.36,.18]:[.1,.22,.33],flap);mesh.rotation.z=side*.22
      const leg=joint([side*.16,.23,0],'x',side<0?0:Math.PI,.4)
      rod(pigeon?'#c18c83':'#d8a92f',[0,0,0],[0,-.17,0],.036,leg)
      ball(pigeon?'#c18c83':'#edbf32',[0,-.18,.085],[.13,.045,.19],leg)
    }
    for(let i=0;i<3;i++) { const tail=point(wing,[(i-1)*.11,.65,-.38],[.13,chicken?.58:.33,.12]);tail.rotation.x=-.65 }
    if(chicken) {
      for(let i=0;i<3;i++)ball('#bf3e32',[0,1.23+i*.028,.34-i*.12],[.055,.13,.09])
      ball('#c53e35',[0,.79,.46],[.075,.12,.06])
    }
    if(pigeon)for(const side of [-1,1])for(let i=0;i<2;i++){const stripe=cube('#2e3c49',[side*.391,.5-i*.1,-.1],[.025,.045,.38]);stripe.rotation.x=-.25}
  } else if (species==='frog' || species==='toad') {
    const toad=species==='toad',base=toad?'#926332':'#50843b'
    ball(base,[0,.31,-.06],[.42,.3,.39]);ball(toad?'#e4bb60':'#c3cc4b',[0,.24,.21],[.33,.22,.15])
    ball(base,[0,.51,.18],[.4,.2,.28])
    for(const side of [-1,1]) {
      ball(base,[side*.23,.64,.21],[.14,.18,.14]);ball('#e1d488',[side*.23,.66,.326],[.099,.112,.03]);ball('#202d1c',[side*.23,.665,.35],[.056,.092,.019])
      const leg=joint([side*.27,.19,-.18],'x',side<0?0:Math.PI,.2)
      ball(base,[side*.14,0,0],[.22,.16,.24],leg);rod(base,[side*.24,-.06,.03],[side*.28,-.15,.28],.055,leg)
      rod(base,[side*.08,.06,.32],[side*.16,-.14,.45],.045,leg)
      for(let k=0;k<3;k++)rod(base,[side*.16,-.14,.45],[side*(.12+k*.05),-.16,.56],.017,leg)
    }
    rod(toad?'#62412b':'#315227',[-.26,.42,.411],[.26,.42,.411],.017)
    if(toad)for(let i=0;i<13;i++){const a=i*2.4;ball('#af7b3c',[Math.cos(a)*.3,.48+Math.sin(a)*.12,-.13+(i%3)*.1],[.035,.04,.035])}
  } else if (species==='rat') {
    ball('#767978',[0,.44,-.09],[.29,.4,.34]);const head=joint([0,.85,.13],'y',0,.1)
    ball('#828784',[0,0,0],[.255,.265,.26],head)
    const snout=point('#767d78',[0,-.055,.32],[.15,.4,.14],head);snout.rotation.x=Math.PI/2
    ball('#c44344',[0,-.055,.505],[.065,.06,.055],head)
    for(const side of [-1,1]){ball('#9d7379',[side*.2,.22,0],[.12,.18,.07],head);ball('#ce989e',[side*.2,.24,.04],[.077,.12,.037],head)}
    eyes(.115,.09,.24,.075,'#77ae45',head)
    for(const side of [-1,1]) {const arm=joint([side*.23,.5,.09],'x',side<0?0:Math.PI,.4);rod('#8b8f8b',[0,0,0],[side*.025,-.2,.08],.036,arm);ball('#c99194',[side*.025,-.2,.08],[.045,.07,.04],arm)}
    legs('#898b86',.16,.12,.2,.052,'#cc9699')
    const tail=joint([0,.17,-.36],'y',0,.26)
    const curve=new THREE.CatmullRomCurve3([[0,0,0],[.12,.04,-.3],[.3,.23,-.55],[.35,.6,-.61]].map(p=>new THREE.Vector3(...p)))
    add(new THREE.TubeGeometry(curve,14,.022,5,false),'#b98083',[0,0,0],[1,1,1],tail)
  } else if(species==='crab') {
    ball('#ba6f2e',[0,.22,0],[.44,.19,.3]);ball('#d49643',[0,.12,.08],[.36,.07,.26])
    for(const side of [-1,1]) {
      for(let i=0;i<4;i++) {
        const z=.17-i*.13;const leg=joint([side*.31,.17,z],'y',i*.8+side,.18)
        rod('#b57b37',[0,0,0],[side*.25,0,-.08],.032,leg);rod('#c79546',[side*.25,0,-.08],[side*.34,-.16,-.12],.018,leg)
      }
      const arm=joint([side*.32,.2,.18],'y',side, .15)
      rod('#bc7430',[0,0,0],[side*.21,.07,.24],.06,arm);ball('#bf782d',[side*.26,.08,.34],[.15,.1,.15],arm)
      for(const fork of [-1,1]) {const claw=point('#dba247',[side*.26+fork*.065,.08,.49],[.065,.25,.055],arm);claw.rotation.x=Math.PI/2;claw.rotation.z=-fork*.2}
      rod('#9e682e',[side*.18,.3,.19],[side*.19,.43,.24],.025);ball('#222e31',[side*.19,.43,.24],[.055,.06,.047])
    }
  } else {
    const shark=species==='shark',gold=species==='goldfish',base=shark?'#416b9e':gold?'#ed9131':'#78a698'
    ball(base,[0,0,0],shark?[.24,.24,.78]:gold?[.25,.31,.4]:[.15,.3,.44])
    ball(shark?'#dbe6dd':gold?'#f3ba4b':'#e9ad59',[0,-.11,.08],shark?[.22,.15,.67]:[.14,.19,.33])
    if(!shark&&!gold)ball('#c36748',[0,-.2,.02],[.11,.1,.33])
    if(shark) {
      ball(base,[0,-.015,.61],[.22,.17,.29]);ball('#233944',[0,-.115,.72],[.14,.035,.13]);
      for(const side of [-1,1])for(let i=0;i<3;i++)rod('#31526b',[side*.228,.04,.25-i*.07],[side*.21,-.085,.23-i*.07],.009)
      for(let i=0;i<5;i++){const tooth=point('#fff9df',[(i-2)*.046,-.13,.8],[.021,.065,.02]);tooth.rotation.z=Math.PI}
    }
    for(const side of [-1,1]) {
      ball('#fffbed',[side*(shark?.185:gold?.22:.13),.07,shark?.58:.22],[.045,.08,.075])
      ball('#202f32',[side*(shark?.216:gold?.251:.161),.07,shark?.61:.24],[.024,.054,.045])
      ball('#ffffff',[side*(shark?.233:gold?.267:.177),.09,shark?.625:.26],[.01,.016,.014])
      const flap=joint([side*.12,-.055,shark?.18:.02],'z',side, .15)
      fin(gold?'#e96728':base,[[0,0,0],[side*(shark?.47:.23),-.08,-.3],[side*.11,0,-.35]],flap)
    }
    fin(gold?'#f5b33b':base,[[0,.13,.2],[0,shark?.65:.51,-.16],[0,.13,-.42]])
    const tail=joint([0,0,shark?-.67:-.35],'y',0,.42)
    ball(base,[0,0,-.09],shark?[.1,.1,.27]:[.085,.1,.15],tail)
    fin(gold?'#ee7928':base,[[0,0,-.16],[0,shark?.43:.32,-.51],[0,.06,-.37]],tail)
    fin(gold?'#f1aa37':base,[[0,0,-.16],[0,shark?-.3:-.3,-.48],[0,-.045,-.35]],tail)
    if(gold)ball('#bb5724',[0,-.04,.396],[.08,.075,.022])
  }
  batchRigidParts(group)
  return {
    group,
    animate(time: number, moving = true) {
      for (const j of joints) j.object.rotation[j.axis] = j.rest + Math.sin(time * (species==='crab'?7:species==='shark'?3:5) + j.phase) * j.amount * (moving ? 1 : .14)
    },
  }
}
