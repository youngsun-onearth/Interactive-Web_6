import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/shampoo-physics.ts', import.meta.url), 'utf8')
const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
const physics = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)

test('foam crown trails a moving scalp and then settles into the tracked pose', () => {
  const up = { x: 0, y: -1 }
  const nodes = physics.createFoamChain({ x: 0, y: 0 }, up, 30, 7)
  const movedRoot = { x: 100, y: 0 }

  for (let frame = 0; frame < 4; frame += 1) {
    physics.stepFoamChain(nodes, movedRoot, up, 30, 1 / 60)
  }
  assert.ok(nodes[0].x > nodes.at(-1).x)
  assert.ok(nodes.at(-1).x < 60)

  for (let frame = 0; frame < 600; frame += 1) {
    physics.stepFoamChain(nodes, movedRoot, up, 30, 1 / 60)
  }
  nodes.forEach((node, index) => {
    assert.ok(Math.abs(node.x - 100) < .05)
    assert.ok(Math.abs(node.y + index * 30) < .05)
  })
})

test('foam crown settles into a saved pulled shape instead of returning straight', () => {
  const root = { x: 0, y: 0 }
  const up = { x: 0, y: -1 }
  const nodes = physics.createFoamChain(root, up, 24, 10)
  const offsets = nodes.map((_, index) => ({
    x: Math.sin(index / (nodes.length - 1) * Math.PI) * 34,
    y: 0,
  }))

  for (let frame = 0; frame < 900; frame += 1) {
    physics.stepFoamChain(nodes, root, up, 24, 1 / 60, offsets)
  }

  assert.ok(nodes[4].x > 26, `expected saved bend, received ${nodes[4].x}`)
  assert.ok(nodes[6].x > 23, `expected the whole curve to remain bent, received ${nodes[6].x}`)
  assert.ok(Math.abs(nodes[0].x) < .05)
})
