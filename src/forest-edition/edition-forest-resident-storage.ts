import * as THREE from 'three'
import { configureResidentMaterial, type ResidentModel } from './edition-forest-resident-model'
import { assignResidentNames } from './edition-forest-resident-names'

export type SavedResidentModel = { object: ReturnType<THREE.Object3D['toJSON']> & { geometries?: ReturnType<THREE.BufferGeometry['toJSON']>[] }; limbs: string[]; head: string | null; height: number; label: string; fingerprint: number; mappedParts: string[] }
export type ResidentState = { id: string; name?: string; direction: number[]; heading: number[] }
type RecordData = ResidentState & { key: string; world: string; model: SavedResidentModel; deleted?: false; updatedAt: number }
type DeletedRecord = { key: string; world: string; id: string; deleted: true; updatedAt: number }
type Walker = { id: string; name: string; model: ResidentModel; direction: THREE.Vector3; heading: THREE.Vector3 }

export function serializeResidentModel(model: ResidentModel): SavedResidentModel {
  const object = model.group.toJSON() as SavedResidentModel['object']
  const geometries = new Map<string, THREE.BufferGeometry>()
  model.group.traverse(o => { if (o instanceof THREE.Mesh) geometries.set(o.geometry.uuid, o.geometry) })
  // Parametric geometries normally export only constructor parameters. Explicit
  // buffer attributes preserve front projection and every hand-edited UV.
  object.geometries = [...geometries.values()].map(geometry => {
    const buffer = new THREE.BufferGeometry().copy(geometry); buffer.uuid = geometry.uuid
    return buffer.toJSON()
  })
  return { object, limbs: model.limbs.map(l => l.uuid), head: model.head?.uuid ?? null, height: model.height, label: model.label, fingerprint: model.fingerprint, mappedParts: [...model.mappedParts] }
}
export async function restoreResidentModel(saved: SavedResidentModel): Promise<ResidentModel> {
  if (!saved?.object?.object || !Number.isFinite(saved.height) || saved.height <= 0) throw new Error('저장된 주민 형식이 올바르지 않아요.')
  const group = await new THREE.ObjectLoader().parseAsync(saved.object) as THREE.Group
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.MeshStandardMaterial>(); const textures = new Set<THREE.Texture>()
  group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    geometries.add(o.geometry)
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      materials.add(material); if (material.map) textures.add(material.map)
      configureResidentMaterial(material, material.userData.residentPart ?? 'whole')
    }
  })
  const limbs = saved.limbs.map(uuid => group.getObjectByProperty('uuid', uuid)).filter((o): o is THREE.Group => o instanceof THREE.Group)
  const head = saved.head ? group.getObjectByProperty('uuid', saved.head) as THREE.Group ?? null : null
  return { group, limbs, head, height: saved.height, label: saved.label, fingerprint: saved.fingerprint, mappedParts: saved.mappedParts,
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()) },
  }
}

let database: Promise<IDBDatabase> | null = null
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('interactive-web-edition-forest-residents', 1)
    request.onupgradeneeded = () => { const store = request.result.createObjectStore('residents', { keyPath: 'key' }); store.createIndex('world', 'world') }
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null }; resolve(request.result) }
    request.onerror = () => { database = null; reject(request.error) }
    request.onblocked = () => { database = null; reject(new Error('주민 저장소가 다른 탭에서 사용 중이에요.')) }
  })
  return database
}
export function createResidentStore(world: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const key = (id: string) => `${world}:${id}`
  // Small sidecar records share the existing store, so no database migration
  // or model rewrite is needed when only a resident's position changes.
  const positionWorld = `@positions:${world}`
  const positionKey = (id: string) => `${positionWorld}:${id}`
  type PositionRecord = ResidentState & { key: string; world: string; updatedAt: number }
  function write(action: (store: IDBObjectStore) => void) {
    const operation = queue.catch(() => {}).then(async () => {
      const db = await openDatabase()
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('residents', 'readwrite'); const store = transaction.objectStore('residents')
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('저장을 완료하지 못했어요.'))
        action(store)
      })
    })
    queue = operation; return operation
  }
  return {
    async list(): Promise<RecordData[]> {
      const db = await openDatabase()
      return new Promise((resolve, reject) => {
        // Allocate legacy names atomically so two tabs cannot rename the same
        // residents differently. Only live records change; tombstones stay put.
        const transaction = db.transaction('residents', 'readwrite'); const store = transaction.objectStore('residents')
        const request = store.index('world').getAll(world); let records: RecordData[] = []
        request.onsuccess = () => {
          const positions = store.index('world').getAll(positionWorld)
          positions.onsuccess = () => {
            const byId = new Map((positions.result as PositionRecord[]).map(p => [p.id, p]))
            const live = (request.result as (RecordData | DeletedRecord)[]).filter((r): r is RecordData => !r.deleted).map(record => {
              const position = byId.get(record.id)
              if (!position || position.updatedAt < record.updatedAt) return record
              const { name, direction, heading, updatedAt } = position
              return { ...record, name, direction, heading, updatedAt }
            })
            live.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
            records = assignResidentNames(live)
            records.forEach((record, i) => { if (record.name !== live[i].name) store.put(record) })
          }
        }
        transaction.oncomplete = () => resolve(records)
        transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('주민 이름을 저장하지 못했어요.'))
      })
    },
    add(state: ResidentState, model: SavedResidentModel) {
      return write(store => {
        const request = store.get(key(state.id))
        request.onsuccess = () => {
          // An old tab must never resurrect a resident with the same identity.
          if (!request.result) {
            const updatedAt = Date.now()
            store.add({ ...state, key: key(state.id), world, model, updatedAt } satisfies RecordData)
            store.put({ ...state, key: positionKey(state.id), world: positionWorld, updatedAt } satisfies PositionRecord)
          }
        }
      })
    },
    positions(states: ResidentState[]) {
      if (!states.length) return Promise.resolve()
      return write(store => { for (const state of states) {
        const request = store.get(positionKey(state.id))
        const savePosition = () => store.put({ ...state, key: positionKey(state.id), world: positionWorld, updatedAt: Date.now() } satisfies PositionRecord)
        request.onsuccess = () => {
          if (request.result) { savePosition(); return }
          // Legacy residents get a sidecar on their first save. Tombstones must
          // still reject late writes from other tabs after permanent removal.
          const legacy = store.get(key(state.id))
          legacy.onsuccess = () => { if (legacy.result && !legacy.result.deleted) savePosition() }
        }
      } })
    },
    remove(id: string) {
      // Keep only an identity tombstone; image/mesh/UV data is permanently removed.
      return write(store => {
        store.delete(positionKey(id))
        store.put({ key: key(id), world, id, deleted: true, updatedAt: Date.now() } satisfies DeletedRecord)
      })
    },
  }
}

export function createResidentPersistence(root: HTMLElement, onRestore: (model: ResidentModel, state: ResidentState) => void, onRemove: (id: string) => void, residents: () => Walker[]) {
  const world = root.dataset.examplePanel ?? 'animal-edition'; const store = createResidentStore(world)
  const deleted = new Set<string>(); const pending = new Map<string, Walker>(); let loaded = false; let lastSave = Date.now()
  const status = document.createElement('button'); status.type = 'button'; status.className = 'edition-forest-storage-status'; status.textContent = '주민 불러오는 중…'; status.disabled = true; root.append(status)
  let channel: BroadcastChannel | null = null
  try { channel = new BroadcastChannel('interactive-web-edition-forest-residents') } catch { /* Persistence still works without tab notifications. */ }
  channel?.addEventListener('message', event => {
    if (event.data?.world !== world || event.data?.type !== 'remove' || typeof event.data.id !== 'string') return
    deleted.add(event.data.id); pending.delete(event.data.id); onRemove(event.data.id)
  })
  const state = (w: Walker): ResidentState => ({ id: w.id, name: w.name, direction: w.direction.toArray(), heading: w.heading.toArray() })
  function saved() { root.dataset.residentStorage = 'saved'; status.textContent = '✓ 이 기기에 저장됨'; status.disabled = true }
  function failed() { root.dataset.residentStorage = 'error'; status.textContent = '저장하지 못했어요 · 눌러서 재시도'; status.disabled = false }
  const ready = (async () => {
    try {
      const records = await store.list(); let errors = 0
      for (const record of records) {
        if (deleted.has(record.id)) continue
        try {
          const model = await restoreResidentModel(record.model)
          if (deleted.has(record.id)) model.dispose(); else onRestore(model, record)
        } catch { errors++ }
      }
      loaded = true
      if (errors) { failed(); status.textContent = '일부 주민을 불러오지 못했어요' } else saved()
    } catch { loaded = true; failed() }
  })()
  async function add(walker: Walker) {
    pending.set(walker.id, walker)
    root.dataset.residentStorage = 'saving'; status.textContent = '주민 저장 중…'; status.disabled = true
    try {
      await ready
      if (deleted.has(walker.id)) return false
      await store.add(state(walker), serializeResidentModel(walker.model)); pending.delete(walker.id); saved(); return true
    } catch { failed(); return false }
  }
  async function flush() {
    if (!loaded) return
    try {
      for (const walker of [...pending.values()]) if (!await add(walker)) return
      await store.positions(residents().filter(w => !deleted.has(w.id)).map(state)); saved()
    } catch { failed() }
  }
  status.onclick = () => void flush()
  window.addEventListener('pagehide', () => { void flush() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush() })
  return {
    ready, add, flush,
    tick() { if (loaded && Date.now() - lastSave > 8000) { lastSave = Date.now(); void flush() } },
    async remove(id: string) {
      try {
        await store.remove(id); deleted.add(id); pending.delete(id); channel?.postMessage({ type: 'remove', world, id }); saved(); return true
      } catch { failed(); return false }
    },
  }
}
