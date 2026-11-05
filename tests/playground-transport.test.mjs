import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Duplex } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { Receiver, Sender } from 'ws'
import { playgroundPlugin } from '../server/playground-plugin.ts'

// Real WebSocket frames travel through an in-memory Duplex. No HTTP server,
// TCP listener, Vite instance, or browser is started by these tests.
class MemorySocket extends Duplex {
  messages = []
  handshake = ''
  closeCode = null
  receiver = new Receiver({ isServer: false })
  constructor() {
    super()
    this.receiver.on('message', buffer => this.messages.push(JSON.parse(buffer.toString())))
    this.receiver.on('conclude', code => { this.closeCode = code })
  }
  _read() {}
  _write(buffer, _encoding, done) {
    if (buffer.toString().startsWith('HTTP/')) this.handshake = buffer.toString()
    else this.receiver.write(buffer)
    done()
  }
  send(message) {
    this.push(Buffer.concat(Sender.frame(Buffer.from(JSON.stringify(message)), {
      fin: true, opcode: 1, mask: true, readOnly: false, rsv1: false,
    })))
  }
}

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const http = new EventEmitter(), middleware = new Map(), sockets = []
  playgroundPlugin().configureServer({ httpServer: http, middlewares: { use: (path, fn) => middleware.set(path, fn) } })
  t.after(() => { http.emit('close'); for (const socket of sockets) socket.destroy() })
  function connect(origin = 'http://192.168.0.10:5173', path = '/__playground') {
    const socket = new MemorySocket(); sockets.push(socket)
    http.emit('upgrade', {
      url: path, method: 'GET', headers: { host: '192.168.0.10:5173', origin,
        upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    }, socket, Buffer.alloc(0))
    return socket
  }
  async function broadcast() { t.mock.timers.tick(100); await setImmediate() }
  return { http, connect, broadcast, middleware }
}

test('two connections receive the same roster; a closed connection disappears from the next snapshot', async t => {
  const { connect, broadcast } = setup(t)
  const one = connect(), two = connect()
  assert.match(one.handshake, /101 Switching Protocols/)
  one.send({ type: 'join', nickname: '하나' }); two.send({ type: 'join', nickname: '둘' })
  await setImmediate(); await broadcast()
  const welcomeOne = one.messages.find(m => m.type === 'welcome'), welcomeTwo = two.messages.find(m => m.type === 'welcome')
  assert.ok(welcomeOne.id); assert.notEqual(welcomeOne.id, welcomeTwo.id)
  assert.deepEqual(one.messages.at(-1).world, two.messages.at(-1).world)
  assert.equal(Object.keys(one.messages.at(-1).world.players).length, 2)
  one.destroy(); await setImmediate(); await broadcast()
  assert.equal(Object.keys(two.messages.at(-1).world.players).length, 1)
  assert.equal(two.messages.at(-1).world.players[welcomeOne.id], undefined)
})

test('transport rejects unrelated origins, ignores Vite HMR, and closes unnamed or flooding peers', async t => {
  const { connect } = setup(t)
  const foreign = connect('http://unrelated.example')
  assert.match(foreign.handshake, /403 Forbidden/); assert.equal(foreign.destroyed, true)
  const hmr = connect('http://192.168.0.10:5173', '/vite-hmr')
  assert.equal(hmr.handshake, ''); assert.equal(hmr.destroyed, false)
  const blank = connect(); blank.send({ type: 'join', nickname: ' ' }); await setImmediate()
  assert.equal(blank.closeCode, 1008)
  const flood = connect(); flood.send({ type: 'join', nickname: '친구' })
  for (let i = 0; i < 110; i++) flood.send({ type: 'input', x: 1, z: 0 })
  await setImmediate(); assert.equal(flood.closeCode, 1008)
})

test('invite helper returns host-local origins and plugin cleanup removes its upgrade listener', t => {
  const { http, middleware } = setup(t)
  let value
  middleware.get('/__playground/info')({ socket: { localPort: 5173 } }, {
    setHeader() {}, end(body) { value = JSON.parse(body) },
  })
  assert.ok(Array.isArray(value.origins))
  assert.ok(value.origins.every(origin => /^http:\/\/[\d.]+:5173$/.test(origin)))
  assert.equal(http.listenerCount('upgrade'), 1)
  http.emit('close'); assert.equal(http.listenerCount('upgrade'), 0)
})
