import test from 'node:test'
import assert from 'node:assert/strict'
import { FOREST_DIALOGUE_LINES, createForestDialogueDeck } from '../src/forest-dialogue-lines.ts'
import { normalizeResidentName, nextResidentName, assignResidentNames } from '../src/forest-resident-names.ts'

test('the forest has exactly 100 distinct, nonempty authored dialogue lines', () => {
  assert.equal(FOREST_DIALOGUE_LINES.length, 100)
  assert.equal(new Set(FOREST_DIALOGUE_LINES).size, 100)
  assert.ok(FOREST_DIALOGUE_LINES.every(line => line.trim().length > 10 && line.length < 100))
})
test('each resident cycles through every line without immediate repetition across decks', () => {
  let seed = 123
  const next = createForestDialogueDeck(() => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296 })
  const first = Array.from({ length: 100 }, next); const second = Array.from({ length: 100 }, next)
  assert.equal(new Set(first).size, 100); assert.equal(new Set(second).size, 100)
  assert.notEqual(first[99], second[0]); assert.notDeepEqual(first, second)
  assert.deepEqual(new Set(first), new Set(FOREST_DIALOGUE_LINES))
})
test('legacy names are assigned without colliding with existing names and remain stable', () => {
  const residents = [{ id: 'a' }, { id: 'b', name: '보리' }, { id: 'c', name: '주민 1' }, { id: 'd', name: '  ' }]
  const named = assignResidentNames(residents)
  assert.deepEqual(named.map(r => r.name), ['주민 2', '보리', '주민 1', '주민 3'])
  assert.deepEqual(assignResidentNames(named), named)
  assert.equal(nextResidentName(named.map(r => r.name)), '주민 4')
  assert.equal(residents[0].name, undefined)
})
test('names normalize whitespace and Hangul and stay within 20 characters', () => {
  assert.equal(normalizeResidentName('  보리\n\t 친구  '), '보리 친구')
  assert.equal(normalizeResidentName('숲'), '숲')
  assert.equal(normalizeResidentName(null), '')
  assert.equal(Array.from(normalizeResidentName('가'.repeat(30))).length, 20)
})
