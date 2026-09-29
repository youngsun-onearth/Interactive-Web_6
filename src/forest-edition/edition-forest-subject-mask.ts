import type { ImageMask } from './edition-forest-resident-types'

type Point = { x: number; y: number }
function components(mask: ImageMask) {
  const { width: w, height: h, values } = mask
  const labels = new Int32Array(values.length); const queue = new Int32Array(values.length)
  const regions: { id: number; size: number; border: number; edges: number; left: number; right: number; top: number; bottom: number }[] = []
  for (let seed = 0; seed < values.length; seed++) {
    if (values[seed] < 128 || labels[seed]) continue
    const id = regions.length + 1; let head = 0; let tail = 1; queue[0] = seed; labels[seed] = id
    const region = { id, size: 0, border: 0, edges: 0, left: w, right: 0, top: h, bottom: 0 }
    while (head < tail) {
      const index = queue[head++]; const x = index % w; const y = Math.floor(index / w); region.size++
      region.left = Math.min(region.left, x); region.right = Math.max(region.right, x); region.top = Math.min(region.top, y); region.bottom = Math.max(region.bottom, y)
      if (!x || !y || x === w - 1 || y === h - 1) region.border++
      if (!x) region.edges |= 1; if (x === w - 1) region.edges |= 2; if (!y) region.edges |= 4; if (y === h - 1) region.edges |= 8
      for (const next of [x ? index - 1 : -1, x < w - 1 ? index + 1 : -1, y ? index - w : -1, y < h - 1 ? index + w : -1]) {
        if (next < 0 || labels[next] || values[next] < 128) continue
        labels[next] = id; queue[tail++] = next
      }
    }
    regions.push(region)
  }
  return { labels, regions }
}

// A background selected by an interactive prompt often wraps all four image
// edges. Polarity is inferred from the exterior, never just the center pixel:
// characters can have gaps between their arms or a genuine hole in their shape.
export function normalizeSubjectMask(input: ImageMask, trustedAlpha = false): ImageMask {
  if (input.width < 2 || input.height < 2 || input.values.length !== input.width * input.height) throw new Error('이미지 윤곽 데이터가 올바르지 않아요.')
  let mask = { ...input, values: Uint8Array.from(input.values, n => n >= 128 ? 255 : 0) }
  let split = components(mask)
  const perimeter = input.width * 2 + input.height * 2 - 4
  const exterior = split.regions.reduce((n, r) => n + r.border, 0) / perimeter
  const edges = split.regions.reduce((bits, r) => bits | r.edges, 0)
  const wrapsFrame = exterior > .7 && [1, 2, 4, 8].filter(edge => edges & edge).length >= 3
  if (wrapsFrame) {
    if (trustedAlpha) throw new Error('투명 이미지에서 형체 대신 테두리가 선택됐어요. 형체가 불투명한 이미지를 선택해 주세요.')
    mask.values = Uint8Array.from(mask.values, n => 255 - n); split = components(mask)
  }
  const sorted = [...split.regions].sort((a, b) => b.size - a.size)
  const main = sorted[0]
  if (!main || main.size < Math.max(12, input.values.length * .001)) throw new Error('형체와 배경을 구분하지 못했어요. 배경이 단순하고 형체가 잘 보이는 이미지를 선택해 주세요.')
  const kept = new Set<number>([main.id])
  // Retain meaningful disconnected ears, paws, accessories, etc., but discard
  // edge-connected leftover background strips and isolated compression specks.
  for (const part of sorted.slice(1)) {
    if (part.size >= Math.max(6, main.size * .012) && (trustedAlpha || part.border / perimeter < .08)) kept.add(part.id)
  }
  mask.values = Uint8Array.from(split.labels, label => kept.has(label) ? 255 : 0)
  const covered = mask.values.reduce((n, value) => n + (value ? 1 : 0), 0) / mask.values.length
  const border = split.regions.filter(r => kept.has(r.id)).reduce((n, r) => n + r.border, 0) / perimeter
  if (covered > .97 || border > .78) throw new Error('배경이 형체로 선택됐어요. 형체 주변에 여백이 있는 이미지로 다시 시도해 주세요.')
  return mask
}

// For illustrations on a flat background, exterior connectivity is more
// reliable than a learned click mask. Only remove background-colored pixels
// reachable from the frame: white eyes, teeth and outlined clothes stay solid.
// Return undefined for textured scenes so they still use learned segmentation.
export function extractPlainBackgroundSubject(rgba: Uint8ClampedArray, width: number, height: number): ImageMask | undefined {
  if (width < 3 || height < 3 || rgba.length !== width * height * 4) return
  const border: number[] = []
  for (let x = 0; x < width; x++) { border.push(x, (height - 1) * width + x) }
  for (let y = 1; y < height - 1; y++) { border.push(y * width, y * width + width - 1) }
  const median = (channel: number) => {
    const values = border.map(i => rgba[i * 4 + channel]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  }
  const rgb = [median(0), median(1), median(2)]
  const distance = (i: number) => Math.hypot(rgba[i * 4] - rgb[0], rgba[i * 4 + 1] - rgb[1], rgba[i * 4 + 2] - rgb[2])
  const distances = border.map(distance).sort((a, b) => a - b)
  const noise = distances[Math.floor(distances.length * .88)]
  if (noise > 30 || border.filter(i => rgba[i * 4 + 3] < 128).length > border.length * .1) return
  const tolerance = Math.min(48, Math.max(18, noise * 1.5 + 12))
  let barrier = Uint8Array.from({ length: width * height }, (_, i) => rgba[i * 4 + 3] >= 128 && distance(i) > tolerance ? 1 : 0)
  if (Math.min(width, height) >= 128) {
    // A one-pixel crack in a resized ink outline otherwise drains a whole
    // white sleeve/eye into the background. Close only these tiny cracks;
    // larger openings between limbs remain connected to the exterior.
    const expanded = new Uint8Array(barrier.length); const closed = new Uint8Array(barrier)
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (barrier[i + dy * width + dx]) expanded[i] = 1
    }
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
      const i = y * width + x; closed[i] = 1
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!expanded[i + dy * width + dx]) closed[i] = 0
    }
    barrier = closed
  }
  const exterior = new Uint8Array(width * height); const queue = new Int32Array(exterior.length)
  let head = 0; let tail = 0
  const visit = (i: number) => {
    if (exterior[i] || barrier[i]) return
    exterior[i] = 1; queue[tail++] = i
  }
  border.forEach(visit)
  while (head < tail) {
    const i = queue[head++]; const x = i % width
    if (x) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < exterior.length - width) visit(i + width)
  }
  // Require substantial exterior whitespace before trusting a flat-background cutout.
  if (tail < exterior.length * .12) return
  try {
    return normalizeSubjectMask({ width, height, values: Uint8Array.from(exterior, (n, i) => !n && rgba[i * 4 + 3] >= 128 ? 255 : 0) }, true)
  } catch { return undefined }
}

// Use the dominant border color to locate a promising point on the subject
// when the image is too complex for exterior background removal.
export function suggestSubjectFocus(rgba: Uint8ClampedArray, width: number, height: number): Point[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4; const r = rgba[i]; const g = rgba[i + 1]; const b = rgba[i + 2]
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5); const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bin.count++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin)
  }
  for (let x = 0; x < width; x += 2) { add(x, 0); add(x, height - 1) }
  for (let y = 1; y < height - 1; y += 2) { add(0, y); add(width - 1, y) }
  const background = [...bins.values()].sort((a, b) => b.count - a.count)[0]
  const values = new Uint8Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const distance = Math.hypot(rgba[i * 4] - background.r / background.count, rgba[i * 4 + 1] - background.g / background.count, rgba[i * 4 + 2] - background.b / background.count)
    values[i] = distance > 42 && rgba[i * 4 + 3] > 127 ? 255 : 0
  }
  const { regions, labels } = components({ width, height, values })
  const perimeter = width * 2 + height * 2 - 4
  const largest = regions.filter(r => r.border / perimeter < .35).sort((a, b) => b.size - a.size)[0]
  if (!largest) return [{ x: .5, y: .45 }, { x: .5, y: .65 }]
  let best = 0; let score = -Infinity
  const cx = (largest.left + largest.right) / 2; const cy = (largest.top + largest.bottom) / 2
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x; if (labels[i] !== largest.id) continue
    const neighbors = [i - 1, i + 1, i - width, i + width].filter(n => labels[n] === largest.id).length
    const candidate = neighbors - Math.hypot((x - cx) / width, (y - cy) / height)
    if (candidate > score) { best = i; score = candidate }
  }
  return [{ x: (best % width + .5) / width, y: (Math.floor(best / width) + .5) / height }, { x: (cx + .5) / width, y: (largest.top + (largest.bottom - largest.top) * .28 + .5) / height }]
}
