import './style.css'
import { createFireworks } from './fireworks'
import { createBubbleWrap } from './bubble-wrap'
import { createLemonade } from './lemonade'
import { createCapture } from './capture'
import { createWaterTouch } from './water-touch'
import { createBalloon } from './balloon'
import { createDoodleFace } from './doodle-face'
import { createRubberHuman } from './rubber-human'
import { createShampoo } from './shampoo'

const STAR_COUNT = 100

type ExampleMode = 'heart' | 'walker' | 'gaze' | 'typing' | 'claw' | 'playground' | 'lemonade' | 'water' | 'balloon' | 'doodle-face' | 'rubber-human' | 'shampoo' | 'animal-forest' | 'animal-forest-extended' | 'animal-forest-edition'

// Temporary display settings. Keep the other examples and features available for restoration.
const VISIBLE_EXAMPLES: readonly ExampleMode[] = ['heart', 'walker', 'gaze', 'typing', 'claw', 'playground']
const SHOW_GUESTBOOK = false
const SHOW_CAPTURE = false

type FaceExpression = 'neutral' | 'surprised' | 'smile' | 'curious' | 'excited'

type FallingLetter = {
  element: HTMLSpanElement
  x: number
  y: number
  velocityX: number
  velocityY: number
  rotation: number
  angularVelocity: number
  size: number
}

type ClawMachineController = {
  start: () => void
  stop: () => void
  resize: () => void
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="night-sky" data-example="heart">
    <a class="guestbook-link" href="${import.meta.env.BASE_URL}guestbook.html" ${SHOW_GUESTBOOK ? '' : 'hidden'}>방명록 ↗</a>
    <button class="example-menu-toggle" type="button" aria-controls="example-menu" aria-expanded="true">예제 목록 접기 ⌃</button>
    <nav id="example-menu" class="example-controls" aria-label="인터랙션 예제 선택">
      <button class="example-button is-active" type="button" data-example="heart" aria-pressed="true">
        <span>01</span> 밤하늘 폭죽
      </button>
      <button class="example-button" type="button" data-example="walker" aria-pressed="false">
        <span>02</span> 뽁뽁이
      </button>
      <button class="example-button" type="button" data-example="gaze" aria-pressed="false">
        <span>03</span> 시선 추적
      </button>
      <button class="example-button" type="button" data-example="typing" aria-pressed="false">
        <span>04</span> 단어 피하기
      </button>
      <button class="example-button" type="button" data-example="claw" aria-pressed="false">
        <span>05</span> 인형뽑기
      </button>
      <button class="example-button" type="button" data-example="playground" aria-pressed="false">
        <span>06</span> 놀이터
      </button>
      <button class="example-button" type="button" data-example="lemonade" aria-pressed="false">
        <span>07</span> Lemonade
      </button>
      <button class="example-button" type="button" data-example="water" aria-pressed="false">
        <span>08</span> WaterTouch
      </button>
      <button class="example-button" type="button" data-example="balloon" aria-pressed="false">
        <span>09</span> Balloon
      </button>
      <button class="example-button" type="button" data-example="doodle-face" aria-pressed="false">
        <span>10</span> DoodleFace
      </button>
      <button class="example-button" type="button" data-example="rubber-human" aria-pressed="false">
        <span>11</span> 고무 인간
      </button>
      <button class="example-button" type="button" data-example="shampoo" aria-pressed="false">
        <span>12</span> Shampoo
      </button>
      <button class="example-button" type="button" data-example="animal-forest" aria-pressed="false"><span>13</span> 동물의 숲</button>
      <button class="example-button" type="button" data-example="animal-forest-extended" aria-pressed="false"><span>14</span> 동물의 숲 확장판</button>
      <button class="example-button" type="button" data-example="animal-forest-edition" aria-pressed="false" title="동물의 숲 우주 에디션"><span>15</span> 동물의 숲 우주 에디션</button>
    </nav>
    <div class="stars" aria-hidden="true"></div>
    <section class="bubble-wrap example-panel" data-example-panel="walker" aria-label="뽁뽁이" hidden></section>
    <section class="heart-example example-panel" data-example-panel="heart" aria-label="밤하늘 폭죽 인터랙션">
      <div class="cloud-haze" aria-hidden="true"></div>
      <h1 class="cloud-title">
        <span class="sr-only">바이브코딩 워크숍</span>
        <canvas class="cloud-title__canvas" aria-hidden="true"></canvas>
      </h1>
      <canvas class="fireworks-canvas" aria-hidden="true"></canvas>
      <p class="fireworks-hint">밤하늘을 누르거나 드래그해 보세요<span>오래 누르면 더 크게 · 드래그 후 놓으면 경로를 따라 연속으로</span></p>
    </section>
    <section class="gaze-example example-panel" data-example-panel="gaze" aria-label="포인터를 바라보는 캐릭터" hidden>
      <div class="gaze-orb">
        <div class="gaze-character" data-expression="neutral">
          <div class="gaze-face" aria-hidden="true">
            <span class="gaze-eye gaze-eye--left">
              <span class="gaze-pupil"><span class="gaze-glint"></span></span>
              <svg class="gaze-brow" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M 20 4.5 C 30 -2.5, 40 -5.5, 50 -5.5 C 60 -5.5, 70 -2.5, 80 4.5" />
              </svg>
            </span>
            <span class="gaze-eye gaze-eye--right">
              <span class="gaze-pupil"><span class="gaze-glint"></span></span>
              <svg class="gaze-brow" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M 20 4.5 C 30 -2.5, 40 -5.5, 50 -5.5 C 60 -5.5, 70 -2.5, 80 4.5" />
              </svg>
            </span>
            <span class="gaze-mouth"></span>
            <span class="gaze-cheek gaze-cheek--left"></span>
            <span class="gaze-cheek gaze-cheek--right"></span>
          </div>
        </div>
        <span class="gaze-orb__shine" aria-hidden="true"></span>
      </div>
      <p class="gaze-hint">나를 보게 움직이고, 클릭해 보세요</p>
    </section>
    <section class="typing-game example-panel" data-example-panel="typing" aria-label="타이핑 단어 피하기 게임" hidden>
      <div class="typing-game__hud" aria-live="polite">
        <p class="typing-game__eyebrow">KEYBOARD INTERACTION 01</p>
        <p class="typing-game__guide">한/영 전환 없이 가운데 단어를 그대로 입력하세요</p>
        <form class="typing-game__form" autocomplete="off">
          <label class="sr-only" for="target-word-input">제시된 단어 입력</label>
          <input
            id="target-word-input"
            class="typing-game__input"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="12"
            placeholder="키보드로 바로 입력"
            readonly
          />
        </form>
        <p class="typing-game__status" data-state="idle">마지막 글자를 입력하면 바로 떨어져요</p>
        <p class="typing-game__score"><span class="typing-game__count">0</span> GLYPHS</p>
      </div>
      <div class="typing-game__word" aria-hidden="true"></div>
      <div class="letter-field" aria-hidden="true"></div>
      <div class="typing-person" aria-label="떨어지는 글자를 피하는 사람">
        <span class="typing-person__shadow"></span>
        <div class="typing-person__body">
          <span class="typing-person__arm typing-person__arm--left"></span>
          <span class="typing-person__arm typing-person__arm--right"></span>
          <span class="typing-person__leg typing-person__leg--left"></span>
          <span class="typing-person__leg typing-person__leg--right"></span>
        </div>
        <div class="typing-person__head">
          <span class="typing-person__hair"></span>
          <span class="typing-person__eye typing-person__eye--left"><i></i></span>
          <span class="typing-person__eye typing-person__eye--right"><i></i></span>
          <span class="typing-person__mouth"></span>
        </div>
      </div>
      <div class="typing-game__over" role="dialog" aria-modal="true" aria-labelledby="game-over-title" hidden>
        <p class="typing-game__over-label">COLLISION!</p>
        <h2 id="game-over-title">GAME OVER</h2>
        <p><strong class="typing-game__final-count">0</strong>개의 글자를 떨어뜨렸어요</p>
        <button class="typing-game__restart" type="button">다시 시작</button>
      </div>
    </section>
    <section class="claw-machine example-panel" data-example-panel="claw" aria-label="3차원 인형뽑기 게임" hidden>
      <div class="claw-machine__viewport" aria-hidden="true"></div>
      <header class="claw-machine__header">
        <div>
          <p>KEYBOARD INTERACTION 02</p>
          <h2>3D CLAW MACHINE</h2>
          <span class="claw-machine__coordinates">X 56 · Z 53</span>
        </div>
        <button class="claw-machine__score" type="button" aria-expanded="false" aria-controls="claw-prize-list">
          <span>PRIZES</span>
          <strong class="claw-machine__count">0</strong>
        </button>
      </header>
      <div class="claw-machine__message">
        <i aria-hidden="true"></i>
        <span class="claw-machine__status" aria-live="polite">드래그로 둘러보고 · 방향키 이동 · SPACE 뽑기</span>
      </div>
      <div class="claw-machine__prize-preview" aria-live="polite">
        <p>YOU GOT IT!</p>
        <span>인형을 뽑았어요</span>
      </div>
      <aside class="claw-machine__prizes" id="claw-prize-list" aria-label="뽑은 인형 목록">
        <header>
          <div><span>COLLECTION</span><strong>뽑은 인형</strong></div>
          <button class="claw-machine__prizes-close" type="button" aria-label="뽑은 인형 목록 닫기">×</button>
        </header>
        <div class="claw-machine__prize-list">
          <p class="claw-machine__prize-empty">아직 뽑은 인형이 없어요</p>
        </div>
      </aside>
      <div class="claw-machine__collection-viewer" aria-hidden="true">
        <p>3D PRIZE VIEW</p>
        <strong class="claw-machine__viewer-name">PRIZE</strong>
        <span>자동으로 회전하고 있어요</span>
        <button class="claw-machine__viewer-close" type="button">목록으로 돌아가기</button>
      </div>
      <div class="claw-machine__controls" aria-label="인형뽑기 조작 버튼">
        <div class="claw-machine__dpad">
          <button type="button" data-claw-move="ArrowUp" aria-label="집게 앞으로 이동">↑</button>
          <button type="button" data-claw-move="ArrowLeft" aria-label="집게 왼쪽 이동">←</button>
          <button type="button" data-claw-move="ArrowDown" aria-label="집게 뒤로 이동">↓</button>
          <button type="button" data-claw-move="ArrowRight" aria-label="집게 오른쪽 이동">→</button>
        </div>
        <button class="claw-machine__drop" type="button">
          <span>DROP</span>
          <kbd>SPACE</kbd>
        </button>
      </div>
      <p class="claw-machine__guide">DRAG · ROTATE &nbsp;&nbsp; ARROW KEYS · MOVE &nbsp;&nbsp; SPACE · DROP</p>
    </section>
    <section class="playground example-panel" data-example-panel="playground" aria-label="함께 노는 3D 놀이터" hidden></section>
    <section class="lemonade example-panel" data-example-panel="lemonade" aria-label="손으로 만드는 Lemonade" hidden></section>
    <section class="water-touch example-panel" data-example-panel="water" aria-label="열 손가락으로 물결을 만드는 WaterTouch" hidden></section>
    <section class="balloon example-panel" data-example-panel="balloon" aria-label="손으로 터뜨리고 끈을 잡는 풍선" hidden></section>
    <section class="doodle-face example-panel" data-example-panel="doodle-face" aria-label="한 카메라로 두 사람이 서로의 얼굴에 그림을 그리는 DoodleFace" hidden></section>
    <section class="rubber-human example-panel" data-example-panel="rubber-human" aria-label="핀치로 얼굴을 부드럽게 늘리는 고무 인간" hidden></section>
    <section class="shampoo example-panel" data-example-panel="shampoo" aria-label="머리 위에 쌓인 거품이 얼굴을 따라움직이는 Shampoo" hidden></section>
    <section class="animal-forest example-panel" data-example-panel="animal-forest" aria-label="동물의 숲 구형 지구본" hidden></section>
    <section class="animal-forest animal-forest--extended example-panel" data-example-panel="animal-forest-extended" aria-label="동물의 숲 확장판" hidden></section>
    <section class="animal-edition animal-edition--extended example-panel" data-example-panel="animal-forest-edition" aria-label="동물의 숲 우주 에디션" hidden></section>
  </main>
`

const stars = document.querySelector<HTMLDivElement>('.stars')!
const nightSky = document.querySelector<HTMLElement>('.night-sky')!
const fireworks = createFireworks(nightSky, document.querySelector<HTMLElement>('.heart-example')!)
const bubbleWrap = createBubbleWrap(document.querySelector<HTMLElement>('.bubble-wrap')!)
const controls = document.querySelector<HTMLElement>('.example-controls')!
const exampleButtons = document.querySelectorAll<HTMLButtonElement>('.example-button')
exampleButtons.forEach((button) => {
  const visible = VISIBLE_EXAMPLES.includes(button.dataset.example as ExampleMode)
  button.hidden = !visible
  button.disabled = !visible
})
if (VISIBLE_EXAMPLES.length <= 3) {
  controls.style.gridTemplateColumns = `repeat(${VISIBLE_EXAMPLES.length}, minmax(0, 1fr))`
  controls.style.maxWidth = '708px'
}
const menuToggle = document.querySelector<HTMLButtonElement>('.example-menu-toggle')!
let menuBeforeBubbleWrap = false
function setMenuCollapsed(collapsed: boolean, persist = true) {
  nightSky.classList.toggle('is-menu-collapsed', collapsed)
  controls.inert = collapsed
  controls.setAttribute('aria-hidden', String(collapsed))
  menuToggle.setAttribute('aria-expanded', String(!collapsed))
  menuToggle.textContent = collapsed ? '예제 목록 펼치기 ⌄' : '예제 목록 접기 ⌃'
  menuToggle.setAttribute('aria-label', collapsed ? '예제 목록 펼치기' : '예제 목록 접기')
  try { if (persist && nightSky.dataset.example !== 'walker') localStorage.setItem('example-menu-collapsed', String(collapsed)) } catch { /* Storage may be unavailable. */ }
}
menuToggle.onclick = event => { event.stopPropagation(); setMenuCollapsed(!nightSky.classList.contains('is-menu-collapsed')) }
for (const event of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup']) menuToggle.addEventListener(event, e => e.stopPropagation())
const sizeMenu = () => nightSky.style.setProperty('--example-menu-bottom', `${controls.offsetTop + controls.offsetHeight + 6}px`)
new ResizeObserver(sizeMenu).observe(controls)
window.addEventListener('resize', sizeMenu)
try { setMenuCollapsed(localStorage.getItem('example-menu-collapsed') === 'true') } catch { setMenuCollapsed(false) }
sizeMenu()
const lemonade = createLemonade(document.querySelector<HTMLElement>('.lemonade')!)
const waterTouch = createWaterTouch(document.querySelector<HTMLElement>('.water-touch')!)
const balloon = createBalloon(document.querySelector<HTMLElement>('.balloon')!)
const doodleFace = createDoodleFace(document.querySelector<HTMLElement>('.doodle-face')!)
const rubberHuman = createRubberHuman(document.querySelector<HTMLElement>('.rubber-human')!)
const shampoo = createShampoo(document.querySelector<HTMLElement>('.shampoo')!)
const examplePanels = document.querySelectorAll<HTMLElement>('[data-example-panel]')
const gazeCharacter = document.querySelector<HTMLElement>('.gaze-character')!
const gazeOrb = document.querySelector<HTMLElement>('.gaze-orb')!
const letterField = document.querySelector<HTMLDivElement>('.letter-field')!
const typingPerson = document.querySelector<HTMLDivElement>('.typing-person')!
const typingCount = document.querySelector<HTMLSpanElement>('.typing-game__count')!
const typingForm = document.querySelector<HTMLFormElement>('.typing-game__form')!
const typingInput = document.querySelector<HTMLInputElement>('.typing-game__input')!
const typingStatus = document.querySelector<HTMLParagraphElement>('.typing-game__status')!
const typingWord = document.querySelector<HTMLDivElement>('.typing-game__word')!
const finalTypingCount = document.querySelector<HTMLElement>('.typing-game__final-count')!
const gameOverPanel = document.querySelector<HTMLDivElement>('.typing-game__over')!
const restartButton = document.querySelector<HTMLButtonElement>('.typing-game__restart')!
const clawMachineElement = document.querySelector<HTMLElement>('.claw-machine')!
let clawMachineGame: ClawMachineController | null = null
let clawMachineLoading: Promise<ClawMachineController> | null = null

const loadClawMachine = () => {
  if (clawMachineGame) return Promise.resolve(clawMachineGame)
  if (!clawMachineLoading) {
    clawMachineLoading = import('./claw-machine').then(({ createClawMachine }) => {
      clawMachineGame = createClawMachine(clawMachineElement)
      return clawMachineGame
    })
  }
  return clawMachineLoading
}

const startClawMachine = async () => {
  const game = await loadClawMachine()

  if (activeExample === 'claw') game.start()
  else game.stop()
}

let forest: ReturnType<typeof import('./animal-forest')['createAnimalForest']> | null = null
let forestLoading: Promise<void> | null = null
const startForest = () => {
  if (forest) { forest.start(); return }
  forestLoading ??= import('./animal-forest').then(({ createAnimalForest }) => {
    forest = createAnimalForest(document.querySelector<HTMLElement>('[data-example-panel="animal-forest"]')!)
    if (activeExample === 'animal-forest') forest.start()
  }).catch(error => {
    forestLoading = null
    document.querySelector<HTMLElement>('[data-example-panel="animal-forest"]')!.textContent = '숲을 불러오지 못했어요. 다른 예제를 선택한 뒤 다시 열어 주세요.'
    console.error(error)
  })
}
let extendedForest: ReturnType<typeof import('./animal-forest')['createAnimalForest']> | null = null
let extendedForestLoading: Promise<void> | null = null
const startExtendedForest = () => {
  if (extendedForest) { extendedForest.start(); return }
  extendedForestLoading ??= import('./animal-forest').then(({ createAnimalForest }) => {
    extendedForest = createAnimalForest(document.querySelector<HTMLElement>('[data-example-panel="animal-forest-extended"]')!, { extended: true })
    if (activeExample === 'animal-forest-extended') extendedForest.start()
  }).catch(error => {
    extendedForestLoading = null
    document.querySelector<HTMLElement>('[data-example-panel="animal-forest-extended"]')!.textContent = '숲을 불러오지 못했어요. 다른 예제를 선택한 뒤 다시 열어 주세요.'
    console.error(error)
  })
}
let editionForest: ReturnType<typeof import('./forest-edition/animal-edition')['createAnimalForest']> | null = null
let editionForestLoading: Promise<void> | null = null
const startEditionForest = () => {
  if (editionForest) { editionForest.start(); return }
  editionForestLoading ??= import('./forest-edition/animal-edition').then(({ createAnimalForest }) => {
    editionForest = createAnimalForest(document.querySelector<HTMLElement>('[data-example-panel="animal-forest-edition"]')!, { extended: true })
    if (activeExample === 'animal-forest-edition') editionForest.start()
  }).catch(error => {
    editionForestLoading = null
    document.querySelector<HTMLElement>('[data-example-panel="animal-forest-edition"]')!.textContent = '숲을 불러오지 못했어요. 다른 예제를 선택한 뒤 다시 열어 주세요.'
    console.error(error)
  })
}
let playground: ReturnType<typeof import('./playground/main')['createPlayground']> | null = null
let playgroundLoading: Promise<void> | null = null
const startPlayground = () => {
  if (playground || playgroundLoading) return playgroundLoading
  const panel = document.querySelector<HTMLElement>('.playground')!
  panel.textContent = '놀이터를 준비하고 있어요…'
  playgroundLoading = import('./playground/main').then(({ createPlayground }) => {
    if (activeExample === 'playground') playground = createPlayground(panel)
  }).catch(error => {
    panel.textContent = '놀이터를 불러오지 못했어요. 다른 예제를 선택한 뒤 다시 열어 주세요.'
    console.error(error)
  }).finally(() => { playgroundLoading = null })
  return playgroundLoading
}
let activeExample: ExampleMode = 'heart'
const capture = SHOW_CAPTURE ? createCapture({
  stage: nightSky,
  getCanvas: () => activeExample === 'animal-forest-edition' ? editionForest?.captureFrame() ?? null : activeExample === 'animal-forest-extended' ? extendedForest?.captureFrame() ?? null : activeExample === 'animal-forest' ? forest?.captureFrame() ?? null : activeExample === 'lemonade'
    ? lemonade.captureFrame()
    : activeExample === 'water' ? waterTouch.captureFrame()
      : activeExample === 'balloon' ? balloon.captureFrame()
        : activeExample === 'doodle-face' ? doodleFace.captureFrame()
          : activeExample === 'rubber-human' ? rubberHuman.captureFrame()
            : activeExample === 'shampoo' ? shampoo.captureFrame()
    : activeExample === 'playground' ? playground?.canvas ?? null
    : activeExample === 'claw' ? clawMachineElement.querySelector<HTMLCanvasElement>('canvas') : null,
  getName: () => activeExample === 'animal-forest-edition' ? 'Animal-Forest-Edition' : activeExample === 'animal-forest-extended' ? 'Animal-Forest-Extended' : activeExample === 'animal-forest' ? 'Animal-Forest' : activeExample === 'shampoo' ? 'Shampoo' : activeExample === 'rubber-human' ? 'Rubber-Human' : activeExample === 'doodle-face' ? 'DoodleFace' : activeExample === 'balloon' ? 'Balloon' : activeExample === 'water' ? 'WaterTouch' : activeExample === 'lemonade' ? 'Lemonade' : `Example-${activeExample}`,
  onPreviewChange: (open) => {
    if (activeExample === 'animal-forest') forest?.setPaused(open)
    if (activeExample === 'animal-forest-extended') extendedForest?.setPaused(open)
    if (activeExample === 'animal-forest-edition') editionForest?.setPaused(open)
    if (activeExample === 'water') waterTouch.setPaused(open)
    if (activeExample === 'balloon') balloon.setPaused(open)
    if (activeExample === 'doodle-face') doodleFace.setPaused(open)
    if (activeExample === 'rubber-human') rubberHuman.setPaused(open)
    if (activeExample === 'shampoo') shampoo.setPaused(open)
  },
  onRecordingChange: (recording) => waterTouch.setCapturing(recording),
}) : null
const fallingLetters: FallingLetter[] = []
const TYPING_GRAVITY = 690
const PLAYER_MAX_SPEED = 330
let typingAnimationFrame = 0
let typingLastFrame = 0
let typingGameRunning = false
let typedLetterCount = 0
let playerX = window.innerWidth / 2
let playerVelocity = 0
let playerTargetX = playerX
let lastAvoidanceUpdate = 0
let wordDisplayTimer = 0
let currentTargetWord = ''
let previousTargetWord = ''
let wordTransitioning = false
let targetInputGlyphs: string[] = []
let enteredGlyphs: string[] = []
let wrongKeyTimer = 0
let typingFocusTimer = 0
let typingFocusFrame = 0
const letterSpawnTimers = new Set<number>()
const KOREAN_WORDS = [
  '사랑', '바다', '하늘', '마음', '사람', '시간', '나무', '구름', '노을', '별빛',
  '여름', '겨울', '봄날', '우주', '산책', '음악', '파도', '여행', '미소', '행복',
  '기억', '오늘', '내일', '바람', '햇살', '새벽', '달빛', '꽃밭', '친구', '미래',
]
const ENGLISH_WORDS = [
  'APPLE', 'CLOUD', 'DREAM', 'LIGHT', 'SPACE', 'HEART', 'WATER', 'SMILE', 'MUSIC', 'NIGHT',
  'OCEAN', 'HAPPY', 'STARS', 'SUMMER', 'WINTER', 'SPRING', 'PLANET', 'FLOWER', 'FRIEND', 'FUTURE',
  'MEMORY', 'SUNSET', 'BREEZE', 'FOREST', 'JOURNEY', 'MORNING', 'PEOPLE', 'MOON', 'WAVE', 'GARDEN',
]

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]
const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
]
const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]
const COMPOUND_VOWELS: Record<string, string[]> = {
  'ㅘ': ['ㅗ', 'ㅏ'],
  'ㅙ': ['ㅗ', 'ㅐ'],
  'ㅚ': ['ㅗ', 'ㅣ'],
  'ㅝ': ['ㅜ', 'ㅓ'],
  'ㅞ': ['ㅜ', 'ㅔ'],
  'ㅟ': ['ㅜ', 'ㅣ'],
  'ㅢ': ['ㅡ', 'ㅣ'],
}
const COMPOUND_FINALS: Record<string, string[]> = {
  'ㄳ': ['ㄱ', 'ㅅ'],
  'ㄵ': ['ㄴ', 'ㅈ'],
  'ㄶ': ['ㄴ', 'ㅎ'],
  'ㄺ': ['ㄹ', 'ㄱ'],
  'ㄻ': ['ㄹ', 'ㅁ'],
  'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'],
  'ㄾ': ['ㄹ', 'ㅌ'],
  'ㄿ': ['ㄹ', 'ㅍ'],
  'ㅀ': ['ㄹ', 'ㅎ'],
  'ㅄ': ['ㅂ', 'ㅅ'],
}
const TWO_SET_KOREAN: Record<string, string> = {
  KeyQ: 'ㅂ', KeyW: 'ㅈ', KeyE: 'ㄷ', KeyR: 'ㄱ', KeyT: 'ㅅ',
  KeyY: 'ㅛ', KeyU: 'ㅕ', KeyI: 'ㅑ', KeyO: 'ㅐ', KeyP: 'ㅔ',
  KeyA: 'ㅁ', KeyS: 'ㄴ', KeyD: 'ㅇ', KeyF: 'ㄹ', KeyG: 'ㅎ',
  KeyH: 'ㅗ', KeyJ: 'ㅓ', KeyK: 'ㅏ', KeyL: 'ㅣ', KeyZ: 'ㅋ',
  KeyX: 'ㅌ', KeyC: 'ㅊ', KeyV: 'ㅍ', KeyB: 'ㅠ', KeyN: 'ㅜ', KeyM: 'ㅡ',
}
const TWO_SET_KOREAN_SHIFT: Record<string, string> = {
  KeyQ: 'ㅃ', KeyW: 'ㅉ', KeyE: 'ㄸ', KeyR: 'ㄲ', KeyT: 'ㅆ',
  KeyO: 'ㅒ', KeyP: 'ㅖ',
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const setTypingStatus = (
  message: string,
  state: 'idle' | 'success' | 'error' = 'idle',
) => {
  typingStatus.textContent = message
  typingStatus.dataset.state = state
}

const clearLetterSpawnTimers = () => {
  letterSpawnTimers.forEach((timer) => window.clearTimeout(timer))
  letterSpawnTimers.clear()
}

const decomposeKoreanSyllable = (character: string) => {
  const codePoint = character.charCodeAt(0)

  if (codePoint < 0xac00 || codePoint > 0xd7a3) return []

  const syllableIndex = codePoint - 0xac00
  const initialIndex = Math.floor(syllableIndex / 588)
  const medialIndex = Math.floor((syllableIndex % 588) / 28)
  const finalIndex = syllableIndex % 28
  const medial = JUNGSEONG[medialIndex]
  const final = JONGSEONG[finalIndex]

  return [
    CHOSEONG[initialIndex],
    ...(COMPOUND_VOWELS[medial] ?? [medial]),
    ...(final ? (COMPOUND_FINALS[final] ?? [final]) : []),
  ]
}

const decomposeWord = (word: string) =>
  /^[a-z]+$/i.test(word)
    ? Array.from(word.toUpperCase())
    : Array.from(word).flatMap(decomposeKoreanSyllable)

const renderTargetWord = () => {
  const isEnglishWord = /^[A-Z]+$/.test(currentTargetWord)
  let glyphOffset = 0

  typingWord.replaceChildren(
    ...Array.from(currentTargetWord).map((character) => {
      if (isEnglishWord) {
        const letter = document.createElement('span')

        letter.className = 'typing-game__word-letter'
        letter.classList.toggle('is-typed', glyphOffset < enteredGlyphs.length)
        letter.textContent = character
        glyphOffset += 1
        return letter
      }

      const syllable = document.createElement('span')
      const syllableText = document.createElement('span')
      const jamoGuide = document.createElement('span')
      const syllableGlyphs = decomposeKoreanSyllable(character)
      const enteredInSyllable = clamp(enteredGlyphs.length - glyphOffset, 0, syllableGlyphs.length)

      syllable.className = 'typing-game__word-syllable'
      syllable.classList.toggle('is-partial', enteredInSyllable > 0)
      syllable.classList.toggle('is-typed', enteredInSyllable === syllableGlyphs.length)
      syllableText.className = 'typing-game__word-syllable-text'
      syllableText.textContent = character
      jamoGuide.className = 'typing-game__jamo-guide'
      jamoGuide.replaceChildren(
        ...syllableGlyphs.map((glyph, index) => {
          const jamo = document.createElement('i')

          jamo.className = 'typing-game__jamo'
          jamo.classList.toggle('is-typed', index < enteredInSyllable)
          jamo.textContent = glyph
          return jamo
        }),
      )
      syllable.append(syllableText, jamoGuide)
      glyphOffset += syllableGlyphs.length
      return syllable
    }),
  )
}

const chooseNextTargetWord = () => {
  const wordBank = Math.random() < 0.5 ? KOREAN_WORDS : ENGLISH_WORDS
  let nextWord = wordBank[Math.floor(Math.random() * wordBank.length)]

  if (nextWord === previousTargetWord) {
    nextWord = wordBank[(wordBank.indexOf(nextWord) + 1) % wordBank.length]
  }

  previousTargetWord = nextWord
  currentTargetWord = nextWord
  wordTransitioning = false
  targetInputGlyphs = decomposeWord(nextWord)
  enteredGlyphs = []
  typingInput.value = ''
  typingInput.disabled = false
  typingInput.lang = /^[A-Z]+$/.test(nextWord) ? 'en' : 'ko'
  typingWord.classList.remove('is-completed', 'has-error')
  renderTargetWord()
  setTypingStatus('마지막 글자를 입력하면 바로 떨어져요')
  cancelAnimationFrame(typingFocusFrame)
  typingFocusFrame = requestAnimationFrame(() => {
    if (typingGameRunning && activeExample === 'typing') typingInput.focus()
  })
}

const removeFallingLetter = (letter: FallingLetter) => {
  const index = fallingLetters.indexOf(letter)

  if (index >= 0) fallingLetters.splice(index, 1)
  letter.element.remove()
}

const clearFallingLetters = () => {
  fallingLetters.forEach((letter) => letter.element.remove())
  fallingLetters.length = 0
}

const setPlayerPosition = () => {
  const halfWidth = 42

  playerX = clamp(playerX, halfWidth, window.innerWidth - halfWidth)
  typingPerson.style.setProperty('--person-x', `${playerX}px`)
  typingPerson.style.setProperty(
    '--person-lean',
    `${clamp(playerVelocity / PLAYER_MAX_SPEED, -1, 1) * 7}deg`,
  )
  typingPerson.classList.toggle('is-running', Math.abs(playerVelocity) > 30)
}

const predictLanding = (letter: FallingLetter, targetY: number) => {
  const distance = targetY - letter.y

  if (distance <= 0) return { time: 0, x: letter.x }

  const discriminant = letter.velocityY ** 2 + 2 * TYPING_GRAVITY * distance
  const time = (-letter.velocityY + Math.sqrt(Math.max(0, discriminant))) / TYPING_GRAVITY

  return {
    time,
    x: clamp(letter.x + letter.velocityX * time, 24, window.innerWidth - 24),
  }
}

const chooseSafePosition = (now: number) => {
  if (now - lastAvoidanceUpdate < 95) return

  lastAvoidanceUpdate = now
  const playerTop = window.innerHeight - 172
  const threats = fallingLetters
    .map((letter) => ({ letter, ...predictLanding(letter, playerTop) }))
    .filter((threat) => threat.time >= 0 && threat.time < 1.75)

  if (threats.length === 0) {
    playerTargetX = window.innerWidth / 2
    return
  }

  const edgePadding = 46
  const candidateCount = Math.max(9, Math.floor(window.innerWidth / 70))
  let safestX = playerX
  let safestScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < candidateCount; index += 1) {
    const candidateX =
      edgePadding + ((window.innerWidth - edgePadding * 2) * index) / (candidateCount - 1)
    const travelTime = Math.abs(candidateX - playerX) / PLAYER_MAX_SPEED
    let closestClearance = Number.POSITIVE_INFINITY

    threats.forEach((threat) => {
      const reachPenalty = Math.max(0, travelTime - threat.time) * PLAYER_MAX_SPEED
      const clearance = Math.abs(candidateX - threat.x) - threat.letter.size * 0.34 - reachPenalty

      closestClearance = Math.min(closestClearance, clearance)
    })

    const movementPenalty = Math.abs(candidateX - playerX) * 0.075
    const score = closestClearance - movementPenalty

    if (score > safestScore) {
      safestScore = score
      safestX = candidateX
    }
  }

  playerTargetX = safestX
}

const updateCharacterGaze = () => {
  if (fallingLetters.length === 0) {
    typingPerson.style.setProperty('--person-look-x', '0px')
    return
  }

  const watchedLetter = fallingLetters.reduce((lowest, letter) =>
    letter.y > lowest.y ? letter : lowest,
  )
  const lookX = clamp((watchedLetter.x - playerX) / 22, -5, 5)

  typingPerson.style.setProperty('--person-look-x', `${lookX}px`)
}

const finishTypingGame = (hitLetter: FallingLetter) => {
  typingGameRunning = false
  clearLetterSpawnTimers()
  cancelAnimationFrame(typingAnimationFrame)
  hitLetter.element.classList.add('is-hit')
  typingPerson.classList.add('is-hit')
  finalTypingCount.textContent = String(typedLetterCount)
  gameOverPanel.hidden = false
  window.clearTimeout(typingFocusTimer)
  typingFocusTimer = window.setTimeout(() => {
    if (activeExample === 'typing') restartButton.focus()
  }, 80)
}

const updateTypingGame = (now: number) => {
  if (!typingGameRunning || activeExample !== 'typing') return

  const deltaTime = Math.min((now - typingLastFrame) / 1000 || 0, 0.034)
  typingLastFrame = now
  const viewportHeight = window.innerHeight
  const playerTop = viewportHeight - 172
  const playerBottom = viewportHeight - 25

  chooseSafePosition(now)

  const desiredVelocity = clamp((playerTargetX - playerX) * 4.4, -PLAYER_MAX_SPEED, PLAYER_MAX_SPEED)
  playerVelocity += (desiredVelocity - playerVelocity) * Math.min(1, deltaTime * 8)
  playerX += playerVelocity * deltaTime
  setPlayerPosition()
  updateCharacterGaze()

  for (let index = fallingLetters.length - 1; index >= 0; index -= 1) {
    const letter = fallingLetters[index]

    letter.velocityY += TYPING_GRAVITY * deltaTime
    letter.x += letter.velocityX * deltaTime
    letter.y += letter.velocityY * deltaTime
    letter.rotation += letter.angularVelocity * deltaTime

    const radius = letter.size * 0.3
    if (letter.x < radius || letter.x > window.innerWidth - radius) {
      letter.x = clamp(letter.x, radius, window.innerWidth - radius)
      letter.velocityX *= -0.68
    }

    letter.element.style.transform =
      `translate3d(${letter.x}px, ${letter.y}px, 0) translate(-50%, -50%) rotate(${letter.rotation}deg)`

    const hitsHorizontally = Math.abs(letter.x - playerX) < radius + 22
    const hitsVertically = letter.y + radius > playerTop && letter.y - radius < playerBottom

    if (hitsHorizontally && hitsVertically) {
      finishTypingGame(letter)
      return
    }

    if (letter.y - radius > viewportHeight) removeFallingLetter(letter)
  }

  typingAnimationFrame = requestAnimationFrame(updateTypingGame)
}

const startTypingGame = () => {
  cancelAnimationFrame(typingAnimationFrame)
  clearLetterSpawnTimers()
  window.clearTimeout(wordDisplayTimer)
  window.clearTimeout(wrongKeyTimer)
  clearFallingLetters()
  typedLetterCount = 0
  typingCount.textContent = '0'
  playerX = window.innerWidth / 2
  playerTargetX = playerX
  playerVelocity = 0
  lastAvoidanceUpdate = 0
  typingPerson.classList.remove('is-hit', 'is-running')
  typingPerson.style.setProperty('--person-look-x', '0px')
  typingInput.value = ''
  typingInput.disabled = false
  gameOverPanel.hidden = true
  typingGameRunning = true
  typingLastFrame = performance.now()
  chooseNextTargetWord()
  setPlayerPosition()
  typingAnimationFrame = requestAnimationFrame(updateTypingGame)
  window.clearTimeout(typingFocusTimer)
  typingFocusTimer = window.setTimeout(() => {
    if (typingGameRunning && activeExample === 'typing') typingInput.focus()
  }, 120)
}

const stopTypingGame = () => {
  typingGameRunning = false
  cancelAnimationFrame(typingAnimationFrame)
  clearLetterSpawnTimers()
  window.clearTimeout(wordDisplayTimer)
  window.clearTimeout(wrongKeyTimer)
  window.clearTimeout(typingFocusTimer)
  cancelAnimationFrame(typingFocusFrame)
  clearFallingLetters()
  typingWord.replaceChildren()
  gameOverPanel.hidden = true
}

const spawnTypedLetter = (character: string) => {
  if (!typingGameRunning) return

  const size = randomBetween(58, 102)
  const nearbySpawn = Math.random() < 0.48
  const x = nearbySpawn
    ? clamp(playerX + randomBetween(-175, 175), size / 2, window.innerWidth - size / 2)
    : randomBetween(size / 2, window.innerWidth - size / 2)
  const element = document.createElement('span')
  const letter: FallingLetter = {
    element,
    x,
    y: -size,
    velocityX: randomBetween(-34, 34),
    velocityY: randomBetween(5, 54),
    rotation: randomBetween(-24, 24),
    angularVelocity: randomBetween(-155, 155),
    size,
  }

  element.className = 'falling-letter'
  element.textContent = character.toUpperCase()
  element.style.fontSize = `${size}px`
  element.style.setProperty('--letter-hue', `${Math.floor(randomBetween(0, 360))}`)
  letterField.append(element)
  fallingLetters.push(letter)

  typedLetterCount += 1
  typingCount.textContent = String(typedLetterCount)
}

const releaseTargetWord = (word: string) => {
  if (wordTransitioning) return

  wordTransitioning = true
  typingInput.disabled = true
  const glyphs = decomposeWord(word)
  const interval = Math.min(105, Math.max(34, 1250 / Math.max(glyphs.length, 1)))

  typingWord.classList.add('is-completed')
  glyphs.forEach((glyph, index) => {
    const timer = window.setTimeout(() => {
      letterSpawnTimers.delete(timer)
      spawnTypedLetter(glyph)
    }, index * interval)

    letterSpawnTimers.add(timer)
  })

  window.clearTimeout(wordDisplayTimer)
  wordDisplayTimer = window.setTimeout(() => {
    if (typingGameRunning && activeExample === 'typing') chooseNextTargetWord()
  }, 150)
}

typingForm.addEventListener('submit', (event) => event.preventDefault())

window.addEventListener('keydown', (event) => {
  if (
    activeExample !== 'typing' ||
    !typingGameRunning ||
    wordTransitioning ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) return

  if (event.code === 'Backspace') {
    event.preventDefault()
    enteredGlyphs.pop()
    typingInput.value = enteredGlyphs.join('')
    typingWord.classList.remove('has-error')
    renderTargetWord()
    setTypingStatus(
      enteredGlyphs.length > 0
        ? `${enteredGlyphs.length} / ${targetInputGlyphs.length}`
        : '마지막 키를 누르면 바로 떨어져요',
      enteredGlyphs.length > 0 ? 'success' : 'idle',
    )
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault()
    setTypingStatus('띄어쓰기나 Enter 없이 글자만 이어서 입력하세요')
    return
  }

  const englishKey = /^Key([A-Z])$/.exec(event.code)?.[1]
  const isEnglishTarget = /^[A-Z]+$/.test(currentTargetWord)
  const enteredKey = isEnglishTarget
    ? englishKey
    : (event.shiftKey ? TWO_SET_KOREAN_SHIFT[event.code] : undefined) ?? TWO_SET_KOREAN[event.code]

  if (!enteredKey) return

  event.preventDefault()
  const expectedKey = targetInputGlyphs[enteredGlyphs.length]

  if (enteredKey !== expectedKey) {
    window.clearTimeout(wrongKeyTimer)
    typingWord.classList.remove('has-error')
    void typingWord.offsetWidth
    typingWord.classList.add('has-error')
    setTypingStatus(`‘${enteredKey}’ 말고 ‘${expectedKey}’ 키를 눌러 보세요`, 'error')
    wrongKeyTimer = window.setTimeout(() => typingWord.classList.remove('has-error'), 420)
    return
  }

  enteredGlyphs.push(enteredKey)
  typingInput.value = enteredGlyphs.join('')
  typingWord.classList.remove('has-error')
  renderTargetWord()
  setTypingStatus(`${enteredGlyphs.length} / ${targetInputGlyphs.length}`, 'success')

  if (enteredGlyphs.length === targetInputGlyphs.length) {
    releaseTargetWord(currentTargetWord)
  }
})

restartButton.addEventListener('click', startTypingGame)

window.addEventListener('resize', () => {
  if (activeExample === 'typing') {
    playerX = clamp(playerX, 42, window.innerWidth - 42)
    playerTargetX = clamp(playerTargetX, 42, window.innerWidth - 42)
    setPlayerPosition()
  }
  if (activeExample === 'claw' && clawMachineGame) {
    requestAnimationFrame(clawMachineGame.resize)
  }
})

for (let index = 0; index < STAR_COUNT; index += 1) {
  const star = document.createElement('span')
  const isBright = index < 16
  const size = isBright ? 3 + Math.random() * 5 : 1 + Math.random() * 2.5

  star.className = isBright ? 'star star--bright' : 'star'
  star.style.setProperty('--x', `${Math.random() * 100}%`)
  star.style.setProperty('--y', `${Math.random() * 100}%`)
  star.style.setProperty('--size', `${size}px`)
  star.style.setProperty('--duration', `${1.4 + Math.random() * 3.5}s`)
  star.style.setProperty('--delay', `${Math.random() * -5}s`)
  stars.append(star)
}

const randomBetween = (minimum: number, maximum: number) =>
  minimum + Math.random() * (maximum - minimum)

let gazeFrame = 0
let winkTimer = 0
let expressionTimer = 0
let lastExpressionAt = 0
let lastExpressionX = Number.NaN
let lastExpressionY = Number.NaN

const faceExpressions: FaceExpression[] = ['surprised', 'smile', 'curious', 'excited']

const updateGaze = (x: number, y: number) => {
  const rect = gazeOrb.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const deltaX = x - centerX
  const deltaY = y - centerY
  const distance = Math.hypot(deltaX, deltaY) || 1
  const intensity = Math.min(1, distance / Math.max(rect.width * 0.45, 1))
  const directionX = (deltaX / distance) * intensity
  const directionY = (deltaY / distance) * intensity

  gazeCharacter.style.setProperty('--face-x', `${directionX * 7}px`)
  gazeCharacter.style.setProperty('--face-y', `${directionY * 5}px`)
  gazeCharacter.style.setProperty('--pupil-x', `${directionX * 13}px`)
  gazeCharacter.style.setProperty('--pupil-y', `${directionY * 9}px`)
  gazeOrb.style.setProperty('--orb-rotate-x', `${directionY * -3.2}deg`)
  gazeOrb.style.setProperty('--orb-rotate-y', `${directionX * 4.2}deg`)
}

const scheduleGaze = (x: number, y: number) => {
  cancelAnimationFrame(gazeFrame)
  gazeFrame = requestAnimationFrame(() => updateGaze(x, y))

  const now = performance.now()
  const movedDistance = Math.hypot(x - lastExpressionX, y - lastExpressionY)

  window.clearTimeout(expressionTimer)
  expressionTimer = window.setTimeout(() => {
    gazeCharacter.dataset.expression = 'neutral'
  }, 950)

  if (now - lastExpressionAt < 420 || movedDistance < 22) return

  const currentExpression = gazeCharacter.dataset.expression as FaceExpression
  const availableExpressions = faceExpressions.filter(
    (expression) => expression !== currentExpression,
  )
  const nextExpression =
    availableExpressions[Math.floor(Math.random() * availableExpressions.length)] ?? 'smile'

  gazeCharacter.dataset.expression = nextExpression
  lastExpressionAt = now
  lastExpressionX = x
  lastExpressionY = y
}

const winkAt = (x: number, y: number) => {
  const rect = gazeOrb.getBoundingClientRect()

  updateGaze(x, y)
  gazeCharacter.dataset.wink = x < rect.left + rect.width / 2 ? 'left' : 'right'
  gazeCharacter.classList.remove('is-winking')
  void gazeCharacter.offsetWidth
  gazeCharacter.classList.add('is-winking')
  window.clearTimeout(winkTimer)
  winkTimer = window.setTimeout(() => gazeCharacter.classList.remove('is-winking'), 620)
}

// Leave navigation and form controls to the browser. Capturing their pointer
// on the stage would retarget the click away from the original control.
const isInterfaceTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(
    '.example-controls, a[href], button, input, textarea, select, [role="button"], [contenteditable]',
  ))

nightSky.addEventListener('pointermove', (event) => {
  if (!isInterfaceTarget(event.target) && activeExample === 'gaze') {
    scheduleGaze(event.clientX, event.clientY)
  }
})

nightSky.addEventListener('pointerdown', (event) => {
  if (activeExample !== 'gaze' || event.button !== 0 || isInterfaceTarget(event.target)) return
  event.preventDefault()
  winkAt(event.clientX, event.clientY)
})

const setExampleRenderingActive = (mode: ExampleMode) => {
  examplePanels.forEach((panel) => {
    const isActive = panel.dataset.examplePanel === mode

    panel.hidden = !isActive
    panel.inert = !isActive
    panel.setAttribute('aria-hidden', String(!isActive))
  })

  fireworks.setActive(mode === 'heart')
  bubbleWrap.setActive(mode === 'walker')
  stars.hidden = mode === 'walker' || mode === 'typing' || mode === 'claw' || mode === 'playground' || mode === 'lemonade' || mode === 'water' || mode === 'balloon' || mode === 'doodle-face' || mode === 'rubber-human' || mode === 'shampoo' || mode === 'animal-forest' || mode === 'animal-forest-extended' || mode === 'animal-forest-edition'
}

setExampleRenderingActive(activeExample)

exampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextExample = button.dataset.example as ExampleMode

    if (!VISIBLE_EXAMPLES.includes(nextExample) || nextExample === activeExample) return

    const previousExample = activeExample
    activeExample = nextExample
    capture?.invalidate()
    nightSky.dataset.example = activeExample
    if (activeExample === 'walker') {
      menuBeforeBubbleWrap = nightSky.classList.contains('is-menu-collapsed')
      setMenuCollapsed(true, false)
    } else if (previousExample === 'walker') {
      setMenuCollapsed(menuBeforeBubbleWrap, false)
    }
    setExampleRenderingActive(activeExample)
    if (activeExample === 'animal-forest') startForest()
    else forest?.stop()
    if (activeExample === 'animal-forest-extended') startExtendedForest()
    else extendedForest?.stop()
    if (activeExample === 'animal-forest-edition') startEditionForest()
    else editionForest?.stop()
    if (activeExample === 'lemonade') lemonade.start()
    else lemonade.stop()
    if (activeExample === 'water') waterTouch.start()
    else waterTouch.stop()
    if (activeExample === 'balloon') balloon.start()
    else balloon.stop()
    if (activeExample === 'doodle-face') doodleFace.start()
    else doodleFace.stop()
    if (activeExample === 'rubber-human') rubberHuman.start()
    else rubberHuman.stop()
    if (activeExample === 'shampoo') shampoo.start()
    else shampoo.stop()

    if (activeExample === 'typing') {
      startTypingGame()
    } else {
      stopTypingGame()
    }

    if (activeExample === 'claw') {
      void startClawMachine()
    } else {
      clawMachineGame?.stop()
    }

    if (activeExample === 'playground') void startPlayground()
    else { playground?.dispose(); playground = null }

    if (activeExample === 'gaze') {
      const rect = gazeOrb.getBoundingClientRect()

      updateGaze(rect.left + rect.width / 2, rect.top + rect.height / 2)
    } else {
      window.clearTimeout(expressionTimer)
      gazeCharacter.dataset.expression = 'neutral'
    }

    exampleButtons.forEach((exampleButton) => {
      const isActive = exampleButton === button

      exampleButton.classList.toggle('is-active', isActive)
      exampleButton.setAttribute('aria-pressed', String(isActive))
    })
  })
})

// Direct preview link for the newest workshop example.
if (location.hash === '#animal-forest') document.querySelector<HTMLButtonElement>('.example-button[data-example="animal-forest"]')?.click()

if (location.hash === '#animal-forest-extended') document.querySelector<HTMLButtonElement>('.example-button[data-example="animal-forest-extended"]')?.click()

if (location.hash === '#animal-forest-edition') document.querySelector<HTMLButtonElement>('.example-button[data-example="animal-forest-edition"]')?.click()

if (location.hash === '#playground') document.querySelector<HTMLButtonElement>('.example-button[data-example="playground"]')?.click()
