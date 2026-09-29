import type { WildlifeSpecies } from './wildlife-models'

// Sound words only. Quiet aquatic animals use bubbles; crabs use claw clicks.
export const wildlifeVoices: Record<WildlifeSpecies, readonly string[]> = {
  crab: ['딱딱, 딱!', '딸깍… 딸깍!'],
  monkey: ['우끼끼! 우끼!', '끼끼, 우끼끼!'],
  toad: ['꾸욱, 꾸욱…', '꾸르륵… 꾸욱!'],
  penguin: ['꽥, 꽤액!', '꾸엑! 꾸엑!'],
  pigeon: ['구구, 구구구…', '구르르… 구구!'],
  siamese: ['야옹~ 냐아옹!', '그르릉… 야옹.'],
  rat: ['찍찍! 찍!', '찌익, 찍찍!'],
  shark: ['보글… 보글…', '첨벙! 보글보글…'],
  duck: ['꽥꽥! 꽤액!', '꽥, 꽥꽥!'],
  dog: ['멍멍! 왈!', '왈왈! 멍!'],
  sheep: ['메에에~', '메에~ 메에에!'],
  goldfish: ['뽀글뽀글…', '뽀끔… 뽀끔!'],
  riverfish: ['보글보글…', '뽀끔, 뽀글…'],
  chicken: ['꼬꼬댁! 꼬꼬!', '꼬끼오~!'],
  calico: ['냐옹~ 야옹!', '갸르릉… 냐아.'],
  frog: ['개굴개굴!', '개굴! 개구르르…'],
}
