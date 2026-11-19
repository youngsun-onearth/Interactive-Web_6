import type { HumanMask } from './types'

export const SNOW_LIMIT = 400
export const LOW_POWER_SNOW_LIMIT = 250
export const SNAPSHOT_STRIDE = 6 // id, x, y, radius, age, angle
export type SnowEmission = { x: number; y: number; span: number; count: number }
export type BodyUpdate = { body: HumanMask; sourceWidth: number; sourceHeight: number; timestamp: number }
export type SimulationInput =
  | { type: 'init'; width: number; height: number; limit: number; revision: number }
  | { type: 'resize'; width: number; height: number; revision: number }
  | { type: 'clear'; revision: number }
  | { type: 'body'; body: HumanMask; sourceWidth: number; sourceHeight: number; timestamp: number; revision: number }
  | { type: 'step'; delta: number; timestamp: number; emissions: SnowEmission[]; bodyUpdate?: BodyUpdate; recycle?: ArrayBuffer; revision: number }
export type SimulationOutput =
  | { type: 'ready'; revision: number }
  | { type: 'error'; message: string; revision: number }
  | { type: 'snapshot'; positions: Float64Array; count: number; falling: boolean; revision: number }
