import * as THREE from 'three'
import { createWildlifeModel, wildlifeSpecies, type WildlifeSpecies } from './wildlife-models'

const UP = new THREE.Vector3(0,1,0)
const WATER_LEVEL = 5.045
const aquatic = new Set<WildlifeSpecies>(['shark','goldfish','riverfish'])
const spherical = (lon: number, lat: number) => new THREE.Vector3(Math.sin(lon)*Math.cos(lat),Math.sin(lat),Math.cos(lon)*Math.cos(lat))
type Terrain = (p: THREE.Vector3) => { radius: number; waterDistance: number }
type Lake = { p: THREE.Vector3; size: number }
export type WildlifeAnimal = {
  id: string; name: string
  species: WildlifeSpecies; model: ReturnType<typeof createWildlifeModel>; anchor: THREE.Group
  direction: THREE.Vector3; heading: THREE.Vector3; phase: number; decision: number; rest: number; scale: number
  meetingControlled?: boolean
}
type Animal = WildlifeAnimal

export function createWildlife({ world, terrain, trees, lakes, rivers, meetingCenter, clearingRadius }: {
  world: THREE.Group; terrain: Terrain; trees: THREE.Vector3[]; lakes: Lake[]; rivers: THREE.Vector3[][]; meetingCenter: THREE.Vector3; clearingRadius: number
}) {
  let seed = 15831
  const random = () => { seed=(Math.imul(seed,1664525)+1013904223)|0; return (seed>>>0)/4294967296 }
  const animals: Animal[] = []
  const swimmers: { animal: Animal; lake: Lake; axis: THREE.Vector3; other: THREE.Vector3; orbit: number; rate: number; time: number; ripple: THREE.Group; path?: THREE.Vector3[] }[] = []
  const root = new THREE.Group(); root.name='에디션 야생동물'; world.add(root)
  const tangent = (normal: THREE.Vector3) => new THREE.Vector3().crossVectors(Math.abs(normal.y)>.9?new THREE.Vector3(1,0,0):UP,normal).normalize()
  const traversable = (point: THREE.Vector3, self?: Animal) => terrain(point).waterDistance > .07
    && point.distanceTo(meetingCenter) > clearingRadius+.035
    && trees.every(tree=>tree.distanceToSquared(point)>.0144)
    && animals.every(other=>other===self || aquatic.has(other.species) || other.direction.distanceToSquared(point)>.009)
  const orient = (animal: Animal, radius: number) => {
    const up=animal.direction, front=animal.heading.clone().addScaledVector(up,-animal.heading.dot(up)).normalize()
    const right=new THREE.Vector3().crossVectors(up,front).normalize()
    animal.anchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,front))
    animal.anchor.position.copy(up).multiplyScalar(radius)
  }
  function spawn(species: WildlifeSpecies, direction: THREE.Vector3, scale: number) {
    const model=createWildlifeModel(species),anchor=new THREE.Group()
    anchor.name=`야생 ${model.group.name}`;anchor.userData.wildlife=true;anchor.userData.species=species
    anchor.add(model.group);model.group.scale.setScalar(scale);root.add(anchor)
    const animal: Animal={id:anchor.uuid,name:model.group.name,species,model,anchor,direction:direction.clone(),heading:tangent(direction).applyAxisAngle(direction,random()*Math.PI*2),phase:random()*20,decision:random()*3,rest:0,scale}
    animals.push(animal);return animal
  }
  const landSpecies=wildlifeSpecies.filter(species=>!aquatic.has(species))
  // The first group lives on the visible hemisphere; the rest populate the far side.
  for(let i=0;i<landSpecies.length+6;i++) {
    let home: THREE.Vector3|null=null
    for(let attempt=0;attempt<2400;attempt++) {
      const point=i<landSpecies.length && attempt<1200
        ? spherical((random()-.5)*2.25,(random()-.5)*1.55)
        : spherical(random()*Math.PI*2,Math.asin(random()*2-1))
      if(traversable(point)) {home=point;break}
    }
    if(!home)continue
    const species=landSpecies[i%landSpecies.length]
    const scale=species==='crab'?.49:species==='monkey'?.39:species==='frog'||species==='toad'?.54:.47
    const animal=spawn(species,home,scale)
    orient(animal,terrain(home).radius+.035)
  }
  lakes.forEach((lake,index)=>{
    const axis=tangent(lake.p),other=new THREE.Vector3().crossVectors(lake.p,axis).normalize()
    // Large fins stay inside a lake. Routes never cross the grass between channels.
    const species: WildlifeSpecies[]=index===2?['goldfish','riverfish']:['shark','goldfish','riverfish']
    species.forEach((kind,k)=>{
      const animal=spawn(kind,lake.p,kind==='shark'?.34:kind==='goldfish'?.3:.32)
      animal.phase=k*Math.PI*2/3+index*.8
      const ripple=new THREE.Group();root.add(ripple)
      for(let j=0;j<2;j++){
        const ring=new THREE.Mesh(new THREE.RingGeometry(.9,1,40),new THREE.MeshBasicMaterial({color:'#dcf8ee',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}))
        ring.userData.offset=j*.5;ripple.add(ring)
      }
      swimmers.push({animal,lake,axis,other,orbit:lake.size*(kind==='shark'?.32:.52),rate:(kind==='shark'?.24:.36)*(k%2?-1:1),time:0,ripple,path:index===0&&k>0 ? rivers[k-1].slice(k===1?45:40,k===1?132:-4) : undefined})
    })
  })
  let previous=0,elapsed=0
  function update(now: number) {
    const dt=previous ? Math.min(.05,Math.max(0,(now-previous)/1000)) : 0;previous=now;elapsed+=dt
    for(const animal of animals) {
      if(aquatic.has(animal.species)||animal.meetingControlled||animal.anchor.userData.incapacitated)continue
      animal.decision-=dt;animal.rest=Math.max(0,animal.rest-dt)
      if(animal.decision<=0) {
        animal.decision=2+random()*4
        animal.heading.applyAxisAngle(animal.direction,(random()-.5)*1.6)
        if(random()<.24)animal.rest=.8+random()*2
      }
      const moving=animal.rest<=0
      if(moving) {
        const speed=animal.species==='rat'?.21:animal.species==='crab'?.1:.145
        const ahead=animal.direction.clone().addScaledVector(animal.heading,.028).normalize()
        if(traversable(ahead,animal)) {
          animal.direction.addScaledVector(animal.heading,dt*speed/5.4).normalize()
          animal.heading.addScaledVector(animal.direction,-animal.heading.dot(animal.direction)).normalize()
        } else animal.heading.applyAxisAngle(animal.direction,dt*2.5)
      }
      const hop=(animal.species==='frog'||animal.species==='toad')&&moving ? Math.pow(Math.max(0,Math.sin(elapsed*4+animal.phase)),2)*.065 : 0
      orient(animal,terrain(animal.direction).radius+.028+hop)
      animal.model.group.position.y=moving?Math.abs(Math.sin(elapsed*5+animal.phase))*.013:Math.sin(elapsed*1.6+animal.phase)*.006
      animal.model.animate(elapsed+animal.phase,moving)
    }
    for(const swimmer of swimmers) {
      const {animal,lake,axis,other,orbit,rate,ripple}=swimmer
      ripple.visible=!animal.meetingControlled&&!animal.anchor.userData.incapacitated
      if(animal.meetingControlled||animal.anchor.userData.incapacitated)continue
      swimmer.time+=dt
      const swimTime=swimmer.time
      const angle=swimTime*rate+animal.phase
      const next=lake.p.clone().addScaledVector(axis,Math.cos(angle)*orbit).addScaledVector(other,Math.sin(angle)*orbit*.78).normalize()
      if(!swimmer.path) animal.heading.copy(axis).multiplyScalar(-Math.sin(angle)*rate).addScaledVector(other,Math.cos(angle)*rate*.78).normalize()
      if(swimmer.path) {
        const path=swimmer.path, travel=swimTime*.105+animal.phase
        const progress=(Math.sin(travel)+1)*.5*(path.length-1)
        const index=Math.min(path.length-2,Math.floor(progress))
        next.copy(path[index]).lerp(path[index+1],progress-index).normalize()
        const heading=path[index+1].clone().sub(path[index]).multiplyScalar(Math.cos(travel)>=0?1:-1).normalize()
        animal.heading.lerp(heading,1-Math.exp(-dt*5)).normalize()
      }
      animal.direction.copy(next)
      // Brief, smooth surface visits, interleaved with longer fully submerged swims.
      const surface=Math.pow((Math.sin(swimTime*.66+animal.phase*2)+1)/2,3)
      const radius=WATER_LEVEL-.225+surface*.24
      orient(animal,radius);animal.model.animate(elapsed+animal.phase)
      ripple.position.copy(next).multiplyScalar(WATER_LEVEL+.009)
      ripple.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),next)
      for(const child of ripple.children) {
        const ring=child as THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>
        const progress=(elapsed*.65+ring.userData.offset)%1
        ring.scale.setScalar(.09+progress*.17)
        ring.material.opacity=Math.max(0,(surface-.5)*2)*.5*(1-progress)
      }
      animal.anchor.userData.submerged=radius<WATER_LEVEL-.1
      animal.anchor.userData.surfaceAmount=surface
    }
  }
  update(0)
  return {
    animals,
    update,
    resetClock() {previous=0},
    count:animals.length,
    speciesCount:new Set(animals.map(a=>a.species)).size,
  }
}
