export type BodyPoint = { x: number; y: number; z: number; visibility?: number }
export type ImageMask = { width: number; height: number; values: Uint8Array }
export type ResidentAnalysis = {
  reference: ImageMask
  person: ImageMask
  referencePose: BodyPoint[]
  pose: BodyPoint[]
  categories: { name: string; score: number; index: number }[]
}
export type VisionRequest =
  | { type: 'init'; base: string }
  | { type: 'analyze'; reference: ImageBitmap; photo: ImageBitmap; alpha?: ImageMask; focus: { x: number; y: number } }
export type VisionResponse =
  | { type: 'ready' }
  | { type: 'progress'; message: string }
  | { type: 'result'; analysis: ResidentAnalysis }
  | { type: 'error'; message: string }
