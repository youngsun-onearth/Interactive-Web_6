import { BodyField } from './body-field'
import { SnowPhysics } from './physics'
import { SNAPSHOT_STRIDE } from './simulation-protocol'
import type { SimulationInput, SimulationOutput } from './simulation-protocol'
import type { Snowflake } from './physics'

const scope = self as unknown as { postMessage(message: SimulationOutput, transfer?: Transferable[]): void }
const body = new BodyField()
let physics: SnowPhysics | null = null, revision = 0, nextId = 1
let identifiers = new WeakMap<Snowflake, number>()
self.addEventListener('message', (event: MessageEvent<SimulationInput>) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      revision = message.revision; physics = new SnowPhysics(message.limit)
      physics.resize(message.width, message.height); body.resize(message.width, message.height)
      scope.postMessage({ type: 'ready', revision }); return
    }
    if (!physics) return
    if (message.type === 'resize') {
      revision = message.revision
      physics.resize(message.width, message.height); body.resize(message.width, message.height)
      scope.postMessage({ type: 'ready', revision }); return
    }
    if (message.type === 'clear') {
      revision = message.revision; physics.clear(); body.clear()
      identifiers = new WeakMap(); nextId = 1
      scope.postMessage({ type: 'ready', revision }); return
    }
    if (message.revision !== revision) return
    if (message.type === 'body') {
      body.update(message.body, message.sourceWidth, message.sourceHeight, message.timestamp); return
    }
    if (message.bodyUpdate) {
      const update = message.bodyUpdate
      body.update(update.body, update.sourceWidth, update.sourceHeight, update.timestamp)
    }
    for (const emission of message.emissions) physics.emit(emission.x, emission.y, emission.span, emission.count)
    physics.step(message.delta, body, message.timestamp)
    const requiredBytes = physics.limit * SNAPSHOT_STRIDE * Float64Array.BYTES_PER_ELEMENT
    const positions = message.recycle?.byteLength === requiredBytes ? new Float64Array(message.recycle) : new Float64Array(physics.limit * SNAPSHOT_STRIDE)
    let offset = 0
    for (const flake of physics.flakes) {
      let id = identifiers.get(flake)
      if (id === undefined) { id = nextId++; identifiers.set(flake, id) }
      positions[offset++] = id; positions[offset++] = flake.x; positions[offset++] = flake.y
      positions[offset++] = flake.radius; positions[offset++] = flake.age; positions[offset++] = flake.angle
    }
    scope.postMessage({ type: 'snapshot', positions, count: physics.flakes.length, falling: physics.falling, revision }, [positions.buffer as ArrayBuffer])
  } catch (error) { scope.postMessage({ type: 'error', message: String(error), revision }) }
})
