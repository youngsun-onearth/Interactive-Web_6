import * as THREE from 'three'

// Each palette is a coordinated outfit, rather than independently random RGB
// values for every limb. The generated canvases are saved with the resident.
const palettes = [
  { name: '숲 산책', top: '#6d8261', accent: '#e9d9ad', pants: '#b4a184', shoes: '#624a38' },
  { name: '바닷바람', top: '#527b8b', accent: '#f2e9d7', pants: '#384c60', shoes: '#a87350' },
  { name: '살구빛 오후', top: '#c78368', accent: '#f3dfba', pants: '#726c58', shoes: '#694c40' },
  { name: '햇살 소풍', top: '#c3a04e', accent: '#faf0d1', pants: '#586c78', shoes: '#72513e' },
  { name: '라벤더 정원', top: '#92839f', accent: '#eee1db', pants: '#5e6570', shoes: '#554b50' },
  { name: '크림 카페', top: '#e0cdae', accent: '#6d8672', pants: '#7f6d59', shoes: '#594b42' },
]
const designs = ['stripe', 'cardigan', 'gingham', 'pocket'] as const

export function createResidentOutfit() {
  const palette = palettes[Math.floor(Math.random() * palettes.length)]
  const design = designs[Math.floor(Math.random() * designs.length)]
  const textures: Record<string, THREE.CanvasTexture> = {}
  function fabric(part: string, color: string, draw?: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256)
    draw?.(ctx)
    // Soft woven detail; restrained contrast keeps the miniature readable.
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .045
    for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 256, 1)
    ctx.fillStyle = '#30291f'; ctx.globalAlpha = .035
    for (let x = 0; x < 256; x += 4) ctx.fillRect(x, 0, 1, 256)
    ctx.globalAlpha = 1
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4
    map.userData.residentTextureSource = 'wardrobe'
    textures[part] = map
    return map
  }
  function pattern(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = palette.accent
    if (design === 'stripe') for (let y = 68; y < 218; y += 31) ctx.fillRect(0, y, 256, 10)
    if (design === 'gingham') {
      ctx.globalAlpha = .24
      for (let i = 0; i < 256; i += 32) { ctx.fillRect(i, 0, 15, 256); ctx.fillRect(0, i, 256, 15) }
      ctx.globalAlpha = 1
    }
  }
  fabric('body', palette.top, ctx => {
    pattern(ctx)
    // Hem and neckline lie near the poles of the projected torso UVs.
    ctx.fillStyle = palette.accent; ctx.fillRect(0, 0, 256, 15); ctx.fillRect(0, 235, 256, 21)
    if (design === 'cardigan') {
      ctx.fillRect(120, 0, 16, 256)
      ctx.strokeStyle = palette.accent; ctx.lineWidth = 7
      ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(128, 92); ctx.lineTo(192, 0); ctx.stroke()
      ctx.fillStyle = palette.shoes
      for (let y = 112; y < 226; y += 32) { ctx.beginPath(); ctx.arc(128, y, 3, 0, Math.PI * 2); ctx.fill() }
    } else {
      ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.roundRect(161, 96, 39, 42, [2, 2, 10, 10]); ctx.fill()
      ctx.strokeStyle = palette.top; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(165, 103); ctx.lineTo(196, 103); ctx.stroke()
    }
  })
  const sleeve = fabric('leftArm', palette.top, ctx => { pattern(ctx); ctx.fillStyle = palette.accent; ctx.fillRect(0, 216, 256, 24) })
  textures.rightArm = sleeve
  const pants = fabric('leftLeg', palette.pants, ctx => {
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .10; ctx.fillRect(52, 0, 2, 256); ctx.fillRect(202, 0, 2, 256); ctx.globalAlpha = 1
  })
  textures.rightLeg = pants
  fabric('shoes', palette.shoes, ctx => {
    ctx.fillStyle = palette.accent; ctx.fillRect(0, 224, 256, 32)
    for (let y = 82; y < 148; y += 20) ctx.fillRect(92, y, 72, 5)
  })
  return { textures, appearance: { palette: palette.name, design } }
}
