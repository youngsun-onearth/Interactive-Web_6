import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaygroundRoom, RIDES, RIDE_IDS, MAX_PLAYERS, SLIDE_CLIMB_TIME, SLIDE_DURATION, SEESAW_LIMIT,
  playerPose, nearestRide, canPump, slidePoint } from '../src/playground/simulation.ts'

// Exercise the authoritative multiplayer rules in memory. No listening server.
function approach(room, id, rideId) {
  const player = room.world.players[id], ride = RIDES[rideId]
  player.x = ride.x; player.z = ride.z + ride.radius + .5
  return player
}
function advance(room, seconds, inputs = {}) {
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    for (const [id, input] of Object.entries(inputs)) room.command(id, { type: 'input', x: 0, z: 0, ...input })
    room.tick(1 / 30)
  }
}

test('entry validates nicknames, assigns new outfits, limits capacity, and returns independent snapshots', () => {
  const room = new PlaygroundRoom()
  assert.equal(room.join('bad', '  \n'), null)
  assert.equal(room.join('bad', {}), null)
  const one = room.join('one', '  친구 🌼  '), two = room.join('two', '친구 🌼')
  assert.equal(one.nickname, '친구 🌼')
  assert.notEqual(one.outfit, two.outfit)
  assert.equal(room.join('one', '중복'), null)
  const snapshot = room.snapshot(); snapshot.players.one.x = 999
  assert.notEqual(room.world.players.one.x, 999)
  for (let i = 2; i < MAX_PLAYERS; i++) assert.ok(room.join(`guest-${i}`, '새 친구'))
  assert.equal(room.join('overflow', '친구'), null)
  room.leave('one'); assert.ok(room.join('new', '새 입장'))
  assert.notEqual(one.outfit, room.world.players.new.outfit)
})

test('movement is normalized, authoritative, bounded, and expires after lost input', () => {
  const room = new PlaygroundRoom(), player = room.join('one', '친구')
  const start = { x: player.x, z: player.z }
  advance(room, .5, { one: { x: 1, z: 1 } })
  assert.ok(Math.abs(Math.hypot(player.x - start.x, player.z - start.z) - 1.75) < .001)
  room.command('one', { type: 'input', x: NaN, z: 0 })
  room.command('one', { type: 'input', x: Infinity, z: 0 })
  advance(room, 1)
  const stopped = { x: player.x, z: player.z }
  advance(room, 2)
  assert.equal(player.x, stopped.x); assert.equal(player.z, stopped.z); assert.equal(player.moving, false)
  advance(room, 30, { one: { x: -1e9, z: -1e9 } })
  assert.ok(player.x >= -12.7 && player.z >= -10.7)
  assert.ok(Number.isFinite(playerPose(room.world, player).x))
})

test('walking respects equipment collision boundaries', () => {
  for (const id of RIDE_IDS) {
    const room = new PlaygroundRoom(); room.join('one', '친구')
    const player = approach(room, 'one', id), ride = RIDES[id]
    advance(room, 2, { one: { z: -1 } })
    assert.ok(Math.hypot(player.x - ride.x, player.z - ride.z) >= ride.radius - .00001)
    assert.equal(nearestRide(player), id)
  }
})

test('simultaneous boarding never duplicates seats; leaving immediately releases capacity', () => {
  for (const id of RIDE_IDS) {
    const room = new PlaygroundRoom(), ride = RIDES[id]
    for (let i = 0; i <= ride.seats; i++) {
      room.join(`${i}`, '친구'); approach(room, `${i}`, id)
      room.command(`${i}`, { type: 'mount', ride: id })
    }
    const riders = Object.values(room.world.players).filter(p => p.riding)
    assert.equal(riders.length, ride.seats)
    assert.equal(new Set(riders.map(p => p.riding.seat)).size, ride.seats)
    assert.equal(room.world.players[`${ride.seats}`].riding, null)
    room.leave('0')
    room.command(`${ride.seats}`, { type: 'mount', ride: id })
    assert.equal(room.world.players[`${ride.seats}`].riding.seat, 0)
  }
})

test('remote boarding and malformed commands cannot teleport or change another player', () => {
  const room = new PlaygroundRoom(); const one = room.join('one', '하나'), two = room.join('two', '둘')
  room.command('one', { type: 'mount', ride: 'swing' }); assert.equal(one.riding, null)
  for (const invalid of [null, [], 'mount', { type: 'mount', ride: '__proto__' }, { type: 'input', x: '1', z: 0 }]) room.command('one', invalid)
  approach(room, 'one', 'swing'); room.command('one', { type: 'mount', ride: 'swing', id: 'two' })
  assert.equal(one.riding.id, 'swing'); assert.equal(two.riding, null)
  room.command('one', { type: 'mount', ride: 'spinner' }); assert.equal(one.riding.id, 'swing')
})

test('swing riders follow animated seats and see the same pose from a snapshot', () => {
  const room = new PlaygroundRoom(); room.join('one', '친구')
  const player = approach(room, 'one', 'swing'); room.command('one', { type: 'mount', ride: 'swing' })
  const before = playerPose(room.world, player)
  room.command('one', { type: 'pump' }); advance(room, .6)
  const after = playerPose(room.world, player), snapshot = room.snapshot()
  assert.notEqual(before.z, after.z); assert.ok(after.y > before.y)
  assert.deepEqual(after, playerPose(snapshot, snapshot.players.one))
  room.command('one', { type: 'dismount' }); assert.equal(player.riding, null)
  assert.ok(Math.hypot(player.x - RIDES.swing.x, player.z - RIDES.swing.z) > RIDES.swing.radius)
})

test('seesaw responds to rider weight and relaxes after departure', () => {
  const room = new PlaygroundRoom()
  for (const id of ['one', 'two']) { room.join(id, id); approach(room, id, 'seesaw') }
  room.command('one', { type: 'mount', ride: 'seesaw' }); advance(room, 1)
  assert.ok(room.world.seesawAngle > .2)
  room.command('two', { type: 'mount', ride: 'seesaw' }); advance(room, 2)
  const one = playerPose(room.world, room.world.players.one), two = playerPose(room.world, room.world.players.two)
  assert.ok(Math.abs(one.y + two.y - 2.4) < .0001); assert.notEqual(one.y, two.y)
  room.leave('one'); room.leave('two'); advance(room, 8)
  assert.ok(Math.abs(room.world.seesawAngle) < .001)
})

test('slide climbs, descends, exits on the ground, and becomes available to the next rider', () => {
  const room = new PlaygroundRoom(); room.join('one', '친구')
  const player = approach(room, 'one', 'slide'); room.command('one', { type: 'mount', ride: 'slide' })
  advance(room, 2); const up = playerPose(room.world, player); assert.ok(up.y > 2)
  advance(room, .7); const down = playerPose(room.world, player); assert.ok(down.z > up.z)
  advance(room, .7); assert.equal(player.riding, null); assert.equal(playerPose(room.world, player).y, 0)
  assert.ok(player.z > RIDES.slide.z + 3)
  room.command('one', { type: 'mount', ride: 'slide' }); assert.equal(player.riding.id, 'slide')
})

test('spinner force ejects an unbraced rider; bracing and resting manage grip', () => {
  const room = new PlaygroundRoom(); room.join('loose', '손 놓은 친구'); room.join('hold', '잡은 친구')
  for (const id of ['loose', 'hold']) { approach(room, id, 'spinner'); room.command(id, { type: 'mount', ride: 'spinner' }) }
  advance(room, 8.5, { hold: { hold: true } })
  const loose = room.world.players.loose, held = room.world.players.hold
  assert.equal(loose.riding, null); assert.match(loose.notice, /착지/)
  assert.equal(held.riding.id, 'spinner'); assert.ok(held.stamina < .5 && held.stamina > 0); assert.equal(held.slip, 0)
  const low = held.stamina
  advance(room, .4, { hold: { hold: false } })
  assert.ok(held.stamina > low); assert.ok(held.slip > 0)
  advance(room, .6, { hold: { hold: true } })
  assert.equal(held.slip, 0)
})

test('swing holding and mistimed presses add no energy; one well-timed press adds just one impulse', () => {
  const rooms = [new PlaygroundRoom(), new PlaygroundRoom()]
  for (const room of rooms) {
    room.join('one', '친구'); approach(room, 'one', 'swing'); room.command('one', { type: 'mount', ride: 'swing' })
  }
  advance(rooms[0], 3, { one: { hold: true } }); advance(rooms[1], 3)
  assert.deepEqual(rooms[0].world.swings, rooms[1].world.swings, 'holding Space never pumps automatically')
  const room = rooms[0], player = room.world.players.one, swing = room.world.swings[0]
  swing.angle = Math.PI / 2; swing.velocity = .2
  room.command('one', { type: 'pump' }); assert.equal(swing.velocity, .2); assert.equal(player.pumpResult, 'miss')
  swing.angle = 0; swing.velocity = 1
  room.command('one', { type: 'pump' }); assert.equal(player.pumpResult, 'hit')
  const velocity = swing.velocity
  for (let i = 0; i < 50; i++) room.command('one', { type: 'pump' })
  assert.equal(swing.velocity, velocity, 'repeat/spam cannot stack impulses in one timing window')
})

test('successive timed swing kicks build height and complete a continuous 360-degree revolution', () => {
  const room = new PlaygroundRoom(); const player = room.join('one', '친구')
  approach(room, 'one', 'swing'); room.command('one', { type: 'mount', ride: 'swing' })
  let kicks = 0, maxHeight = 0, maxAngle = 0, largestStep = 0, previous = room.world.swings[0].angle
  for (let i = 0; i < 15 * 30; i++) {
    if (canPump(room.world, player)) { room.command('one', { type: 'pump' }); kicks++ }
    room.tick(1 / 30)
    const angle = room.world.swings[0].angle
    maxAngle = Math.max(maxAngle, Math.abs(angle)); maxHeight = Math.max(maxHeight, playerPose(room.world, player).y)
    largestStep = Math.max(largestStep, Math.abs(angle - previous)); previous = angle
  }
  assert.ok(kicks > 5); assert.ok(maxAngle > Math.PI * 2); assert.ok(maxHeight > 5.7)
  assert.ok(largestStep < .3, 'rotation remains continuous through the top and angle wrap')
  assert.equal(room.world.swings[1].angle, 0, 'each seat has independent physics')
})

test('seesaw requires alternating low-end kicks and gains height over successive turns', () => {
  const room = new PlaygroundRoom()
  for (const id of ['one', 'two']) { room.join(id, id); approach(room, id, 'seesaw'); room.command(id, { type: 'mount', ride: 'seesaw' }) }
  assert.equal(canPump(room.world, room.world.players.one), true)
  assert.equal(canPump(room.world, room.world.players.two), false)
  const before = room.world.seesawVelocity
  room.command('two', { type: 'pump' }); assert.equal(room.world.seesawVelocity, before)
  const turns = []
  for (let i = 0; i < 12 * 30; i++) {
    for (const p of Object.values(room.world.players)) if (canPump(room.world, p)) {
      turns.push({ seat: p.riding.seat, angle: Math.abs(room.world.seesawAngle) })
      room.command(p.id, { type: 'pump' })
    }
    room.tick(1 / 30)
  }
  assert.ok(turns.length >= 6)
  for (let i = 1; i < 5; i++) {
    assert.notEqual(turns[i].seat, turns[i - 1].seat)
    assert.ok(turns[i].angle > turns[i - 1].angle + .015)
  }
  assert.ok(turns.some(turn => turn.angle > .46)); assert.ok(Math.abs(room.world.seesawAngle) <= SEESAW_LIMIT)
  const idle = new PlaygroundRoom()
  for (const id of ['one', 'two']) { idle.join(id, id); approach(idle, id, 'seesaw'); idle.command(id, { type: 'mount', ride: 'seesaw' }) }
  let max = 0
  for (let i = 0; i < 8 * 30; i++) {
    for (const id of ['one', 'two']) idle.command(id, { type: 'input', x: 0, z: 0, hold: true })
    idle.tick(1 / 30); max = Math.max(max, Math.abs(idle.world.seesawAngle))
  }
  assert.ok(max <= .121, 'holding both controls does not grow the seesaw height')
})

test('winding slide changes direction repeatedly and finishes its descent in about one second', () => {
  const room = new PlaygroundRoom(), player = room.join('one', '친구')
  approach(room, 'one', 'slide'); room.command('one', { type: 'mount', ride: 'slide' })
  let previous = slidePoint(0), length = 0, left = 0, right = 0, directionChanges = 0, lastSign = 0
  for (let i = 1; i <= 200; i++) {
    const point = slidePoint(i / 200), sign = Math.sign(point.x - previous.x)
    length += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z)
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    assert.ok(point.y <= previous.y && point.z > previous.z)
    if (lastSign && sign !== lastSign) directionChanges++
    lastSign = sign; previous = point
  }
  assert.ok(left < -.9 && right > .5); assert.ok(directionChanges >= 3)
  assert.ok(length / SLIDE_DURATION > 6, 'faster than the old straight chute')
  room.world.time = SLIDE_CLIMB_TIME + SLIDE_DURATION * .5
  const halfway = slidePoint(.5 * .45 + .5 ** 2 * .55), pose = playerPose(room.world, player)
  assert.ok(Math.abs(pose.x - RIDES.slide.x - halfway.x) < 1e-10)
  assert.ok(Math.abs(pose.z - RIDES.slide.z - halfway.z) < 1e-10)
  room.world.time = SLIDE_CLIMB_TIME + SLIDE_DURATION + .09; room.tick(.02)
  assert.equal(player.riding, null)
})

test('spinner keeps accelerating with fixed occupancy and drains grip faster at higher speed', () => {
  const room = new PlaygroundRoom(), player = room.join('one', '친구')
  approach(room, 'one', 'spinner'); room.command('one', { type: 'mount', ride: 'spinner' })
  const speeds = [], losses = []
  for (let i = 0; i < 5; i++) {
    const before = player.stamina; advance(room, 1, { one: { hold: true } })
    speeds.push(room.world.spinSpeed); losses.push(before - player.stamina)
  }
  for (let i = 1; i < speeds.length; i++) { assert.ok(speeds[i] > speeds[i - 1]); assert.ok(losses[i] > losses[i - 1]) }
  const slow = new PlaygroundRoom(), fast = new PlaygroundRoom()
  for (const [state, speed] of [[slow, 1], [fast, 5]]) {
    state.join('one', '친구'); approach(state, 'one', 'spinner'); state.command('one', { type: 'mount', ride: 'spinner' })
    state.world.spinSpeed = speed; advance(state, .5, { one: { hold: true } })
  }
  assert.ok(1 - fast.world.players.one.stamina > (1 - slow.world.players.one.stamina) * 4)
  const highSpeed = room.world.spinSpeed; room.command('one', { type: 'dismount' }); advance(room, 2)
  assert.ok(room.world.spinSpeed < highSpeed)
})

test('full room remains finite through movement, boarding, and repeated disconnects', () => {
  const room = new PlaygroundRoom()
  for (let i = 0; i < MAX_PLAYERS; i++) {
    room.join(String(i), `친구 ${i}`)
    const rideId = RIDE_IDS[i % 4]; approach(room, String(i), rideId)
    room.command(String(i), { type: 'mount', ride: rideId })
  }
  advance(room, 20)
  for (const player of Object.values(room.world.players)) {
    const pose = playerPose(room.world, player)
    assert.ok(Object.values(pose).every(Number.isFinite))
    assert.ok(player.stamina >= 0 && player.stamina <= 1)
  }
  for (const id of Object.keys(room.world.players)) { room.leave(id); room.leave(id) }
  assert.equal(Object.keys(room.snapshot().players).length, 0)
})
