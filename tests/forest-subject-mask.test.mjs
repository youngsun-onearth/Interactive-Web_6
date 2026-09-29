import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPlainBackgroundSubject, normalizeSubjectMask, suggestSubjectFocus } from '../src/forest-subject-mask.ts'

const mask = fn => ({ width: 80, height: 80, values: Uint8Array.from({ length: 6400 }, (_, i) => fn(i % 80, Math.floor(i / 80)) ? 255 : 0) })
const body = (x, y) => Math.hypot((x - 40) / 18, (y - 41) / 29) < 1

test('an inverted mask models the character rather than its surrounding rectangular background', () => {
  const foreground = mask(body); const inverted = mask((x, y) => !body(x, y))
  assert.deepEqual(normalizeSubjectMask(inverted).values, foreground.values)
  assert.deepEqual(normalizeSubjectMask(foreground).values, foreground.values)
})
test('a real gap inside a character is not used to guess polarity or filled in', () => {
  const ring = mask((x, y) => Math.hypot(x - 40, y - 40) < 29 && Math.hypot(x - 40, y - 40) > 13)
  const result = normalizeSubjectMask(ring)
  assert.equal(result.values[40 * 80 + 40], 0)
  assert.deepEqual(result.values, ring.values)
  assert.deepEqual(normalizeSubjectMask(ring, true).values, ring.values)
})
test('background split into two pieces by a subject touching top and bottom is still inverted', () => {
  const shape = mask(x => x > 26 && x < 54)
  const negative = mask(x => x <= 26 || x >= 54)
  assert.deepEqual(normalizeSubjectMask(negative).values, shape.values)
})
test('transparent foreground keeps disconnected features and removes insignificant specks', () => {
  const alpha = mask((x, y) => body(x, y) || (x > 18 && x < 25 && y > 4 && y < 12) || (x === 0 && y === 0))
  const result = normalizeSubjectMask(alpha, true)
  assert.equal(result.values[6 * 80 + 21], 255)
  assert.equal(result.values[0], 0)
})
test('empty, full-frame and opaque-border alpha masks never reach the model builder', () => {
  assert.throws(() => normalizeSubjectMask(mask(() => false)))
  assert.throws(() => normalizeSubjectMask(mask(() => true)))
  assert.throws(() => normalizeSubjectMask(mask((x, y) => !body(x, y)), true))
})
test('the segmentation prompt follows an off-center subject instead of the image center', () => {
  const rgba = new Uint8ClampedArray(80 * 80 * 4).fill(255)
  for (let y = 15; y < 67; y++) for (let x = 52; x < 74; x++) {
    const i = (y * 80 + x) * 4; rgba[i] = 75; rgba[i + 1] = 100; rgba[i + 2] = 150
  }
  const [focus] = suggestSubjectFocus(rgba, 80, 80)
  assert.ok(focus.x > .65 && focus.x < .925)
  assert.ok(focus.y > .19 && focus.y < .84)
})

const illustration = (background = [255, 255, 255]) => {
  const width = 160; const height = 220
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) rgba.set([...background, 255], i * 4)
  const paint = (left, top, right, bottom, color) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) rgba.set([...color, 255], (y * width + x) * 4)
  }
  const dark = [20, 20, 20]; const yellow = [255, 216, 0]
  // Large upper whitespace, a colored body, white outlined eyes/shirt,
  // thin arms and two separated legs: the regression shown by the user.
  paint(49, 70, 111, 151, dark); paint(51, 72, 109, 149, yellow)
  paint(60, 88, 77, 111, dark); paint(62, 90, 75, 109, [255, 255, 255])
  paint(84, 88, 101, 111, dark); paint(86, 90, 99, 109, [255, 255, 255])
  paint(51, 139, 109, 149, [255, 255, 255])
  paint(30, 115, 50, 118, dark); paint(110, 115, 130, 118, dark)
  paint(59, 150, 63, 179, dark); paint(97, 150, 101, 179, dark)
  paint(54, 178, 66, 184, dark); paint(94, 178, 106, 184, dark)
  return { rgba, width, height, paint }
}
const at = (result, x, y) => result.values[y * result.width + x]

test('plain white background removes outer whitespace but keeps white eyes, clothing and thin limbs', () => {
  const input = illustration(); const result = extractPlainBackgroundSubject(input.rgba, input.width, input.height)
  assert.ok(result)
  for (const [x, y] of [[65, 96], [90, 96], [80, 145], [35, 116], [125, 116], [61, 170], [99, 170], [56, 181]]) assert.equal(at(result, x, y), 255, `missing subject at ${x},${y}`)
  for (const [x, y] of [[0, 0], [80, 35], [40, 140], [120, 140], [80, 165], [80, 210]]) assert.equal(at(result, x, y), 0, `background retained at ${x},${y}`)
  assert.deepEqual(normalizeSubjectMask(result).values, result.values)
})
test('flat off-white and dark backgrounds work without hardcoding white', () => {
  for (const color of [[247, 243, 236], [45, 60, 82]]) {
    const input = illustration(color); const result = extractPlainBackgroundSubject(input.rgba, input.width, input.height)
    assert.ok(result); assert.equal(at(result, 80, 80), 255); assert.equal(at(result, 80, 30), 0); assert.equal(at(result, 65, 96), 255)
  }
})
test('small background color variations do not turn into a rectangular model', () => {
  const input = illustration([248, 248, 248])
  for (let i = 0; i < input.width * input.height; i++) if (input.rgba[i * 4] === 248) {
    const noise = (i * 13 % 11) - 5
    for (let c = 0; c < 3; c++) input.rgba[i * 4 + c] += noise
  }
  const result = extractPlainBackgroundSubject(input.rgba, input.width, input.height)
  assert.ok(result); assert.equal(at(result, 80, 30), 0); assert.equal(at(result, 80, 80), 255)
})
test('blank images and complex backgrounds do not produce a fabricated cutout', () => {
  const input = illustration(); input.paint(0, 0, input.width, input.height, [255, 255, 255])
  assert.equal(extractPlainBackgroundSubject(input.rgba, input.width, input.height), undefined)
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const i = (y * input.width + x) * 4
    input.rgba[i] = x * 71 % 256; input.rgba[i + 1] = y * 39 % 256; input.rgba[i + 2] = (x + y) * 23 % 256
  }
  assert.equal(extractPlainBackgroundSubject(input.rgba, input.width, input.height), undefined)
})

test('a tiny break in an outlined white detail does not hollow out that detail', () => {
  const input = illustration()
  input.paint(70, 109, 71, 140, [255, 255, 255])
  input.paint(79, 149, 80, 150, [255, 255, 255])
  const result = extractPlainBackgroundSubject(input.rgba, input.width, input.height)
  assert.ok(result); assert.equal(at(result, 65, 96), 255); assert.equal(at(result, 80, 145), 255); assert.equal(at(result, 80, 165), 0)
})
