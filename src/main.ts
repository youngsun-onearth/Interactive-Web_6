import './style.css'
import { createLemonade } from './lemonade'
import { createCapture } from './capture'
import { createWaterTouch } from './water-touch'
import { createBalloon } from './balloon'
import { createDoodleFace } from './doodle-face'
import { createRubberHuman } from './rubber-human'
import { createShampoo } from './shampoo'

const STAR_COUNT = 100
const title = '바이브코딩워크숍'
const PAD_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'] as const

type ExampleMode = 'heart' | 'walker' | 'gaze' | 'typing' | 'claw' | 'sampler' | 'lemonade' | 'water' | 'balloon' | 'doodle-face' | 'rubber-human' | 'shampoo' | 'animal-forest' | 'animal-forest-extended' | 'animal-forest-edition'
type FaceExpression = 'neutral' | 'surprised' | 'smile' | 'curious' | 'excited'
type PadKey = (typeof PAD_KEYS)[number]

type HeldHeart = {
  element: HTMLSpanElement
  startedAt: number
  animationFrame: number
}

type DraggedWalker = {
  element: HTMLSpanElement
  lane: HTMLDivElement
  offsetX: number
  offsetY: number
}

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

type SamplePad = {
  key: PadKey
  buffer: AudioBuffer | null
  pitch: number
  speed: number
  source: 'empty' | 'file' | 'recording'
  label: string
}

type SamplerSequenceEvent = {
  time: number
  key: PadKey
  pitch: number
  speed: number
}

type SamplerRecording = {
  id: number
  name: string
  duration: number
  events: SamplerSequenceEvent[]
}

type ClawMachineController = {
  start: () => void
  stop: () => void
  resize: () => void
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="night-sky" data-example="heart">
    <a class="guestbook-link" href="${import.meta.env.BASE_URL}guestbook.html">방명록 ↗</a>
    <button class="example-menu-toggle" type="button" aria-controls="example-menu" aria-expanded="true">예제 목록 접기 ⌃</button>
    <nav id="example-menu" class="example-controls" aria-label="인터랙션 예제 선택">
      <button class="example-button is-active" type="button" data-example="heart" aria-pressed="true">
        <span>01</span> 하트 풍선
      </button>
      <button class="example-button" type="button" data-example="walker" aria-pressed="false">
        <span>02</span> 글자 포획
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
      <button class="example-button" type="button" data-example="sampler" aria-pressed="false">
        <span>06</span> 키 샘플러
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
    <div class="walkers" aria-hidden="true"></div>
    <section class="heart-example example-panel" data-example-panel="heart" aria-label="하트 풍선 인터랙션">
      <h1 class="heart-title"><span>바이브코딩</span> <span>워크숍</span></h1>
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
    <section class="sampler example-panel" data-example-panel="sampler" aria-label="키보드와 터치로 연주하고 녹음하는 샘플러" hidden>
      <div class="sampler__ambient" aria-hidden="true"></div>
      <header class="sampler__header">
        <div>
          <p>KEYBOARD INTERACTION 03</p>
          <h2>9 KEY SAMPLER</h2>
          <span>QWE · ASD · ZXC</span>
        </div>
        <div class="sampler__header-actions">
          <button class="sampler__loop-record" type="button" aria-pressed="false">
            <i aria-hidden="true"></i>
            <span>녹음</span>
            <kbd>SPACE</kbd>
          </button>
          <button class="sampler__sample" type="button" aria-pressed="false">
            <i aria-hidden="true"></i>
            <span>샘플링</span>
          </button>
        </div>
      </header>

      <section class="sampler__editor" aria-label="선택한 사운드 편집">
        <div class="sampler__selection">
          <span>EDITING</span>
          <strong class="sampler__selected-key">—</strong>
          <small class="sampler__selected-name">키를 길게 눌러 편집하세요</small>
        </div>
        <div class="sampler__parameter">
          <span>PITCH</span>
          <div>
            <button type="button" data-parameter="pitch" data-direction="-1" aria-label="피치 낮추기">−</button>
            <output class="sampler__pitch">0 ST</output>
            <button type="button" data-parameter="pitch" data-direction="1" aria-label="피치 높이기">＋</button>
          </div>
        </div>
        <div class="sampler__parameter">
          <span>SPEED</span>
          <div>
            <button type="button" data-parameter="speed" data-direction="-1" aria-label="속도 느리게">−</button>
            <output class="sampler__speed">1.0×</output>
            <button type="button" data-parameter="speed" data-direction="1" aria-label="속도 빠르게">＋</button>
          </div>
        </div>
      </section>

      <div class="sampler__stage">
        <div class="sampler__pads" role="group" aria-label="샘플 패드">
        <button class="sampler-pad" type="button" data-pad="q" style="--pad-color: #ff5d7d" aria-label="Q 샘플 패드">
          <span>Q</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="w" style="--pad-color: #ff984f" aria-label="W 샘플 패드">
          <span>W</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="e" style="--pad-color: #ffd45c" aria-label="E 샘플 패드">
          <span>E</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="a" style="--pad-color: #70dc8f" aria-label="A 샘플 패드">
          <span>A</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="s" style="--pad-color: #42d5ca" aria-label="S 샘플 패드">
          <span>S</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="d" style="--pad-color: #51b7ff" aria-label="D 샘플 패드">
          <span>D</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="z" style="--pad-color: #7e8cff" aria-label="Z 샘플 패드">
          <span>Z</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="x" style="--pad-color: #ad78ff" aria-label="X 샘플 패드">
          <span>X</span><small>EMPTY</small>
        </button>
        <button class="sampler-pad" type="button" data-pad="c" style="--pad-color: #ef70dd" aria-label="C 샘플 패드">
          <span>C</span><small>EMPTY</small>
        </button>
        </div>
        <aside class="sampler__recordings" aria-label="녹음본 목록">
          <header>
            <div><span>LOOPS</span><strong>녹음본</strong></div>
            <button class="sampler__new-loop" type="button">＋ 새 녹음</button>
          </header>
          <div class="sampler__recording-list">
            <p class="sampler__recording-empty">새 녹음을 만들거나<br>SPACE를 눌러 시작하세요</p>
          </div>
        </aside>
      </div>

      <footer class="sampler__footer">
        <p class="sampler__status" aria-live="polite">사운드 파일을 확인하는 중…</p>
        <p><code>public/sounds/q.wav</code> 또는 <code>q.mp3</code> 형식으로 넣으세요</p>
        <span>SPACE: 녹음/완료 · 길게 누르기: 패드 편집</span>
      </footer>
    </section>
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
const walkers = document.querySelector<HTMLDivElement>('.walkers')!
const nightSky = document.querySelector<HTMLElement>('.night-sky')!
const controls = document.querySelector<HTMLElement>('.example-controls')!
const menuToggle = document.querySelector<HTMLButtonElement>('.example-menu-toggle')!
function setMenuCollapsed(collapsed: boolean) {
  nightSky.classList.toggle('is-menu-collapsed', collapsed)
  controls.inert = collapsed
  controls.setAttribute('aria-hidden', String(collapsed))
  menuToggle.setAttribute('aria-expanded', String(!collapsed))
  menuToggle.textContent = collapsed ? '예제 목록 펼치기 ⌄' : '예제 목록 접기 ⌃'
  try { localStorage.setItem('example-menu-collapsed', String(collapsed)) } catch { /* Storage may be unavailable. */ }
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
const exampleButtons = document.querySelectorAll<HTMLButtonElement>('.example-button')
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
const samplerElement = document.querySelector<HTMLElement>('.sampler')!
const samplerPads = document.querySelectorAll<HTMLButtonElement>('.sampler-pad')
const samplerSampleButton = document.querySelector<HTMLButtonElement>('.sampler__sample')!
const samplerLoopRecordButton = document.querySelector<HTMLButtonElement>('.sampler__loop-record')!
const samplerNewLoopButton = document.querySelector<HTMLButtonElement>('.sampler__new-loop')!
const samplerRecordingList = document.querySelector<HTMLDivElement>('.sampler__recording-list')!
const samplerStatus = document.querySelector<HTMLElement>('.sampler__status')!
const samplerSelectedKey = document.querySelector<HTMLElement>('.sampler__selected-key')!
const samplerSelectedName = document.querySelector<HTMLElement>('.sampler__selected-name')!
const samplerPitchOutput = document.querySelector<HTMLOutputElement>('.sampler__pitch')!
const samplerSpeedOutput = document.querySelector<HTMLOutputElement>('.sampler__speed')!
const samplerParameterButtons = document.querySelectorAll<HTMLButtonElement>('.sampler__parameter button')
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
let activeExample: ExampleMode = 'heart'
const capture = createCapture({
  stage: nightSky,
  getCanvas: () => activeExample === 'animal-forest-edition' ? editionForest?.captureFrame() ?? null : activeExample === 'animal-forest-extended' ? extendedForest?.captureFrame() ?? null : activeExample === 'animal-forest' ? forest?.captureFrame() ?? null : activeExample === 'lemonade'
    ? lemonade.captureFrame()
    : activeExample === 'water' ? waterTouch.captureFrame()
      : activeExample === 'balloon' ? balloon.captureFrame()
        : activeExample === 'doodle-face' ? doodleFace.captureFrame()
          : activeExample === 'rubber-human' ? rubberHuman.captureFrame()
            : activeExample === 'shampoo' ? shampoo.captureFrame()
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
})
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
const samplePadStates = new Map<PadKey, SamplePad>(PAD_KEYS.map((key) => [key, {
  key,
  buffer: null,
  pitch: 0,
  speed: 1,
  source: 'empty',
  label: 'EMPTY',
}]))
const samplerSources = new Set<AudioBufferSourceNode>()
const keyboardHoldTimers = new Map<PadKey, number>()
const pointerHoldStates = new Map<number, { key: PadKey; timer: number }>()
const activePadInputs = new Map<PadKey, Set<string>>()
let samplerAudioContext: AudioContext | null = null
let samplerMasterGain: GainNode | null = null
let samplesLoadingPromise: Promise<void> | null = null
let selectedPadKey: PadKey | null = null
let samplerRunning = false
let recordState: 'idle' | 'armed' | 'starting' | 'recording' | 'saving' = 'idle'
let recordingPadKey: PadKey | null = null
let samplerMediaRecorder: MediaRecorder | null = null
let samplerMediaStream: MediaStream | null = null
let recordedChunks: Blob[] = []
const samplerRecordings: SamplerRecording[] = []
const loopSources = new Set<AudioBufferSourceNode>()
let nextSamplerRecordingId = 1
let selectedRecordingId: number | null = null
let activeLoopId: number | null = null
let loopScheduleTimer = 0
let sequenceRecording = false
let sequenceRecordStartedAt = 0
let sequenceRecordDuration = 0
let sequenceRecordedEvents: SamplerSequenceEvent[] = []

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

const getPadElement = (key: PadKey) =>
  document.querySelector<HTMLButtonElement>('.sampler-pad[data-pad="' + key + '"]')!

const getSamplerAudioContext = () => {
  if (!samplerAudioContext) {
    samplerAudioContext = new AudioContext({ latencyHint: 'interactive' })
    samplerMasterGain = samplerAudioContext.createGain()
    const compressor = samplerAudioContext.createDynamicsCompressor()

    samplerMasterGain.gain.value = 0.78
    compressor.threshold.value = -10
    compressor.knee.value = 8
    compressor.ratio.value = 5
    compressor.attack.value = 0.002
    compressor.release.value = 0.12
    samplerMasterGain.connect(compressor)
    compressor.connect(samplerAudioContext.destination)
  }

  return samplerAudioContext
}

const updatePadDisplay = (key: PadKey) => {
  const pad = samplePadStates.get(key)!
  const element = getPadElement(key)
  const label = element.querySelector('small')!

  label.textContent = pad.label
  element.classList.toggle('has-sound', Boolean(pad.buffer))
  element.setAttribute(
    'aria-label',
    key.toUpperCase() + ' 샘플 패드, ' + (pad.buffer ? pad.label + ' 사운드 설정됨' : '사운드 없음'),
  )
}

const updateSamplerEditor = () => {
  const pad = selectedPadKey ? samplePadStates.get(selectedPadKey)! : null

  samplerElement.classList.toggle('has-selection', Boolean(pad))
  samplerSelectedKey.textContent = pad ? pad.key.toUpperCase() : '—'
  samplerSelectedName.textContent = pad
    ? pad.label + ' · 피치와 속도를 조절할 수 있어요'
    : '키를 길게 눌러 편집하세요'
  samplerPitchOutput.textContent = pad ? (pad.pitch > 0 ? '+' : '') + pad.pitch + ' ST' : '0 ST'
  samplerSpeedOutput.textContent = pad ? pad.speed.toFixed(1) + '×' : '1.0×'
  samplerParameterButtons.forEach((button) => {
    button.disabled = !pad
  })

  samplerPads.forEach((element) => {
    element.classList.toggle('is-selected', element.dataset.pad === selectedPadKey)
  })
}

const updateRecordButton = () => {
  samplerSampleButton.dataset.state = recordState
  samplerSampleButton.classList.toggle('is-armed', recordState === 'armed')
  samplerSampleButton.classList.toggle(
    'is-recording',
    recordState === 'starting' || recordState === 'recording' || recordState === 'saving',
  )
  samplerSampleButton.setAttribute('aria-pressed', String(recordState !== 'idle'))
  samplerLoopRecordButton.disabled = recordState !== 'idle'

  const label = samplerSampleButton.querySelector('span')!
  label.textContent =
    recordState === 'armed' ? '키 선택' :
      recordState === 'starting' ? '마이크 연결' :
        recordState === 'recording' ? '샘플링 중' :
          recordState === 'saving' ? '저장 중' :
            '샘플링'
}

const loadSampleForPad = async (key: PadKey) => {
  const context = getSamplerAudioContext()
  const extensions = ['wav', 'mp3'] as const

  for (const extension of extensions) {
    try {
      const url = import.meta.env.BASE_URL + 'sounds/' + key + '.' + extension
      const response = await fetch(url)
      if (!response.ok) continue

      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      const pad = samplePadStates.get(key)!

      pad.buffer = buffer
      pad.source = 'file'
      pad.label = extension.toUpperCase()
      updatePadDisplay(key)
      return true
    } catch {
      // WAV가 없거나 디코딩할 수 없으면 MP3를 이어서 확인합니다.
    }
  }

  updatePadDisplay(key)
  return false
}

const loadBundledSamples = () => {
  if (samplesLoadingPromise) return samplesLoadingPromise

  samplerElement.classList.add('is-loading')
  samplerStatus.textContent = 'public/sounds 폴더의 WAV · MP3 파일을 불러오는 중…'
  samplesLoadingPromise = Promise.all(PAD_KEYS.map(loadSampleForPad))
    .then((results) => {
      const loadedCount = results.filter(Boolean).length
      samplerStatus.textContent = loadedCount > 0
        ? loadedCount + '개 사운드 준비 완료'
        : '파일이 없어도 샘플링 버튼으로 각 패드에 사운드를 설정할 수 있어요'
    })
    .finally(() => {
      samplerElement.classList.remove('is-loading')
    })

  return samplesLoadingPromise
}

const playSample = (
  key: PadKey,
  options?: { pitch?: number; speed?: number; when?: number; loop?: boolean },
) => {
  const pad = samplePadStates.get(key)!
  const element = getPadElement(key)

  if (!pad.buffer) {
    element.classList.remove('is-empty-hit')
    void element.offsetWidth
    element.classList.add('is-empty-hit')
    samplerStatus.textContent = key.toUpperCase() + ' 패드에 사운드가 설정되지 않았어요'
    return null
  }

  const context = getSamplerAudioContext()
  if (context.state === 'suspended') void context.resume()

  const source = context.createBufferSource()
  source.buffer = pad.buffer
  const startTime = Math.max(context.currentTime, options?.when ?? context.currentTime)
  source.playbackRate.setValueAtTime(options?.speed ?? pad.speed, startTime)
  source.detune.setValueAtTime((options?.pitch ?? pad.pitch) * 100, startTime)
  source.connect(samplerMasterGain!)
  samplerSources.add(source)
  if (options?.loop) loopSources.add(source)
  source.addEventListener('ended', () => {
    samplerSources.delete(source)
    loopSources.delete(source)
  }, { once: true })
  source.start(startTime)
  return source
}

const setPadInputActive = (key: PadKey, token: string, active: boolean) => {
  const inputs = activePadInputs.get(key) ?? new Set<string>()

  if (active) {
    inputs.add(token)
    activePadInputs.set(key, inputs)
  } else {
    inputs.delete(token)
    if (inputs.size === 0) activePadInputs.delete(key)
  }

  getPadElement(key).classList.toggle('is-active', inputs.size > 0)
}

const selectSamplerPad = (key: PadKey) => {
  selectedPadKey = key
  updateSamplerEditor()
  samplerStatus.textContent = key.toUpperCase() + ' 패드 편집 모드'
}

const getSelectedRecording = () =>
  samplerRecordings.find((recording) => recording.id === selectedRecordingId) ?? null

const renderRecordingList = () => {
  samplerRecordingList.replaceChildren()

  if (samplerRecordings.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'sampler__recording-empty'
    empty.innerHTML = '새 녹음을 만들거나<br>SPACE를 눌러 시작하세요'
    samplerRecordingList.append(empty)
    return
  }

  samplerRecordings.forEach((recording) => {
    const item = document.createElement('article')
    const selectButton = document.createElement('button')
    const title = document.createElement('strong')
    const meta = document.createElement('span')
    const playButton = document.createElement('button')

    item.className = 'sampler-recording'
    item.classList.toggle('is-selected', recording.id === selectedRecordingId)
    item.classList.toggle('is-playing', recording.id === activeLoopId)
    item.classList.toggle('is-recording', sequenceRecording && recording.id === selectedRecordingId)
    selectButton.className = 'sampler-recording__select'
    title.textContent = recording.name
    meta.textContent = recording.duration > 0
      ? (recording.duration / 1000).toFixed(1) + ' S · ' + recording.events.length + ' HITS'
      : 'EMPTY · 녹음 대기'
    selectButton.append(title, meta)
    selectButton.addEventListener('click', () => {
      if (sequenceRecording) return
      if (activeLoopId !== null && activeLoopId !== recording.id) stopLoopPlayback()
      selectedRecordingId = recording.id
      renderRecordingList()
      samplerStatus.textContent = recording.name + ' 선택됨 · SPACE로 ' +
        (recording.duration > 0 ? '레이어 녹음' : '첫 녹음')
    })

    playButton.className = 'sampler-recording__play'
    playButton.type = 'button'
    playButton.disabled = recording.events.length === 0 || sequenceRecording
    playButton.setAttribute('aria-label', recording.id === activeLoopId ? '반복 재생 중지' : '반복 재생')
    playButton.textContent = recording.id === activeLoopId ? '■' : '▶'
    playButton.addEventListener('click', () => {
      if (sequenceRecording) return
      if (activeLoopId === recording.id) {
        stopLoopPlayback()
        samplerStatus.textContent = recording.name + ' 반복 재생 중지'
      } else {
        selectedRecordingId = recording.id
        startLoopPlayback(recording)
        samplerStatus.textContent = recording.name + ' 반복 재생 중'
      }
    })

    item.append(selectButton, playButton)
    samplerRecordingList.append(item)
  })
}

const stopLoopPlayback = () => {
  window.clearTimeout(loopScheduleTimer)
  loopScheduleTimer = 0
  loopSources.forEach((source) => {
    try {
      source.stop()
    } catch {
      // 이미 재생을 끝낸 소스는 무시합니다.
    }
  })
  loopSources.clear()
  activeLoopId = null
  renderRecordingList()
}

const scheduleLoopCycle = (recording: SamplerRecording, cycleStart: number) => {
  if (activeLoopId !== recording.id || recording.duration <= 0) return

  const context = getSamplerAudioContext()
  recording.events.forEach((event) => {
    playSample(event.key, {
      pitch: event.pitch,
      speed: event.speed,
      when: cycleStart + event.time / 1000,
      loop: true,
    })
  })

  const nextCycle = cycleStart + recording.duration / 1000
  const scheduleDelay = Math.max(0, (nextCycle - context.currentTime - 0.045) * 1000)
  loopScheduleTimer = window.setTimeout(() => scheduleLoopCycle(recording, nextCycle), scheduleDelay)
}

const startLoopPlayback = (recording: SamplerRecording) => {
  if (recording.duration <= 0 || recording.events.length === 0) return performance.now()

  stopLoopPlayback()
  const context = getSamplerAudioContext()
  if (context.state === 'suspended') void context.resume()

  const startDelay = 45
  const cycleStart = context.currentTime + startDelay / 1000
  activeLoopId = recording.id
  scheduleLoopCycle(recording, cycleStart)
  renderRecordingList()
  return performance.now() + startDelay
}

const createSamplerRecording = () => {
  if (sequenceRecording) return getSelectedRecording()

  stopLoopPlayback()
  const recording: SamplerRecording = {
    id: nextSamplerRecordingId,
    name: 'LOOP ' + String(nextSamplerRecordingId).padStart(2, '0'),
    duration: 0,
    events: [],
  }

  nextSamplerRecordingId += 1
  samplerRecordings.unshift(recording)
  selectedRecordingId = recording.id
  renderRecordingList()
  samplerStatus.textContent = recording.name + ' 준비됨 · 녹음 또는 SPACE를 누르세요'
  return recording
}

const updateLoopRecordButton = () => {
  samplerLoopRecordButton.classList.toggle('is-recording', sequenceRecording)
  samplerLoopRecordButton.setAttribute('aria-pressed', String(sequenceRecording))
  samplerLoopRecordButton.querySelector('span')!.textContent = sequenceRecording ? '완료' : '녹음'
  samplerNewLoopButton.disabled = sequenceRecording
  samplerSampleButton.disabled = sequenceRecording
}

const startSequenceRecording = () => {
  if (recordState !== 'idle') {
    samplerStatus.textContent = '패드 샘플링을 먼저 완료하거나 취소해 주세요'
    return
  }

  const recording = getSelectedRecording() ?? createSamplerRecording()
  if (!recording) return

  sequenceRecordedEvents = []
  sequenceRecordDuration = recording.duration
  sequenceRecording = true
  sequenceRecordStartedAt = recording.duration > 0
    ? startLoopPlayback(recording)
    : performance.now()
  updateLoopRecordButton()
  renderRecordingList()
  samplerStatus.textContent = recording.duration > 0
    ? recording.name + ' 재생 중 · 새 연주를 레이어로 쌓으세요'
    : recording.name + ' 녹음 중 · 패드를 연주하세요'
}

const stopSequenceRecording = () => {
  if (!sequenceRecording) return

  const recording = getSelectedRecording()
  const elapsed = Math.max(0, performance.now() - sequenceRecordStartedAt)
  sequenceRecording = false

  if (recording) {
    if (recording.duration <= 0 && sequenceRecordedEvents.length > 0) {
      recording.duration = Math.max(250, elapsed)
    }
    recording.events.push(...sequenceRecordedEvents)
    recording.events.sort((first, second) => first.time - second.time)
  }

  sequenceRecordedEvents = []
  sequenceRecordDuration = 0
  stopLoopPlayback()
  updateLoopRecordButton()
  renderRecordingList()
  samplerStatus.textContent = recording
    ? recording.events.length > 0
      ? recording.name + ' 저장 완료 · 재생 버튼으로 반복할 수 있어요'
      : recording.name + '에 연주가 없어 빈 녹음으로 남았어요'
    : '녹음을 완료했어요'
}

const toggleSequenceRecording = () => {
  if (sequenceRecording) stopSequenceRecording()
  else startSequenceRecording()
}

const captureSequenceEvent = (key: PadKey) => {
  if (!sequenceRecording) return

  const pad = samplePadStates.get(key)!
  if (!pad.buffer) return

  const elapsed = Math.max(0, performance.now() - sequenceRecordStartedAt)
  const time = sequenceRecordDuration > 0 ? elapsed % sequenceRecordDuration : elapsed
  sequenceRecordedEvents.push({ key, time, pitch: pad.pitch, speed: pad.speed })
}

const finishRecording = async (chunks: BlobPart[], mimeType: string, key: PadKey) => {
  try {
    const blob = new Blob(chunks, { type: mimeType })
    if (blob.size === 0) throw new Error('empty recording')

    const context = getSamplerAudioContext()
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    const pad = samplePadStates.get(key)!

    pad.buffer = buffer
    pad.source = 'recording'
    pad.label = 'MIC'
    selectedPadKey = key
    updatePadDisplay(key)
    updateSamplerEditor()
    samplerStatus.textContent = key.toUpperCase() + ' 패드에 마이크 샘플이 저장됐어요'
  } catch {
    samplerStatus.textContent = '마이크 샘플을 처리하지 못했어요. 조금 더 길게 녹음해 보세요'
  } finally {
    samplerMediaStream?.getTracks().forEach((track) => track.stop())
    samplerMediaStream = null
    samplerMediaRecorder = null
    recordedChunks = []
    recordingPadKey = null
    recordState = 'idle'
    samplerPads.forEach((element) => element.classList.remove('is-recording'))
    updateRecordButton()
  }
}

const stopPadRecording = () => {
  if (
    recordState !== 'recording' ||
    !samplerMediaRecorder ||
    samplerMediaRecorder.state === 'inactive' ||
    !recordingPadKey
  ) return

  recordState = 'saving'
  updateRecordButton()
  samplerStatus.textContent = '마이크 샘플을 사운드 패드로 변환하는 중…'
  samplerMediaRecorder.stop()
}

const startPadRecording = async (key: PadKey) => {
  if (recordState !== 'armed') return

  recordState = 'starting'
  recordingPadKey = key
  getPadElement(key).classList.add('is-recording')
  updateRecordButton()
  samplerStatus.textContent = key.toUpperCase() + ' 패드용 마이크를 연결하는 중…'

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    })

    if (!samplerRunning || recordState !== 'starting' || recordingPadKey !== key) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/webm',
    ]
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

    samplerMediaStream = stream
    samplerMediaRecorder = recorder
    recordedChunks = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      const chunks = [...recordedChunks]
      void finishRecording(chunks, recorder.mimeType, key)
    }, { once: true })
    recorder.start(40)
    recordState = 'recording'
    updateRecordButton()
    samplerStatus.textContent = key.toUpperCase() + ' 샘플링 중 · 같은 패드를 다시 누르면 완료'
  } catch {
    recordState = 'idle'
    recordingPadKey = null
    getPadElement(key).classList.remove('is-recording')
    updateRecordButton()
    samplerStatus.textContent = '마이크 권한을 허용해야 녹음할 수 있어요'
  }
}

const triggerSamplerPad = (key: PadKey) => {
  if (recordState === 'armed') {
    void startPadRecording(key)
    return
  }

  if (recordState === 'recording' && recordingPadKey === key) {
    stopPadRecording()
    return
  }

  if (recordState === 'starting' || recordState === 'saving') return
  if (playSample(key)) captureSequenceEvent(key)
}

const beginSamplerInput = (key: PadKey, token: string) => {
  setPadInputActive(key, token, true)
  triggerSamplerPad(key)
}

const endSamplerInput = (key: PadKey, token: string) => {
  setPadInputActive(key, token, false)
}

const releaseAllSamplerInputs = () => {
  keyboardHoldTimers.forEach((timer) => window.clearTimeout(timer))
  keyboardHoldTimers.clear()
  pointerHoldStates.forEach((state) => window.clearTimeout(state.timer))
  pointerHoldStates.clear()
  activePadInputs.clear()
  samplerPads.forEach((element) => element.classList.remove('is-active'))
}

const armSamplerRecording = () => {
  if (sequenceRecording) {
    samplerStatus.textContent = '루프 녹음을 먼저 완료해 주세요'
    return
  }

  if (recordState === 'recording') {
    stopPadRecording()
    return
  }

  if (recordState === 'starting' || recordState === 'saving') return

  recordState = recordState === 'armed' ? 'idle' : 'armed'
  recordingPadKey = null
  updateRecordButton()
  samplerStatus.textContent = recordState === 'armed'
    ? '마이크로 샘플링할 QWE · ASD · ZXC 키를 하나 누르세요'
    : '샘플링 대기 상태를 취소했어요'
}

const startSampler = () => {
  samplerRunning = true
  if (samplerAudioContext?.state === 'suspended') void samplerAudioContext.resume()
  updateSamplerEditor()
  updateRecordButton()
  updateLoopRecordButton()
  renderRecordingList()
  void loadBundledSamples()
}

const stopSampler = () => {
  if (sequenceRecording) stopSequenceRecording()
  else stopLoopPlayback()
  samplerRunning = false
  releaseAllSamplerInputs()
  samplerSources.forEach((source) => {
    try {
      source.stop()
    } catch {
      // 이미 끝난 소스는 무시합니다.
    }
  })
  samplerSources.clear()

  if (recordState === 'recording') {
    stopPadRecording()
  } else if (recordState === 'starting' || recordState === 'armed') {
    samplerMediaStream?.getTracks().forEach((track) => track.stop())
    samplerMediaStream = null
    recordingPadKey = null
    recordState = 'idle'
    samplerPads.forEach((element) => element.classList.remove('is-recording'))
    updateRecordButton()
  }

  if (samplerAudioContext?.state === 'running') void samplerAudioContext.suspend()
}

window.addEventListener('keydown', (event) => {
  if (
    activeExample !== 'sampler' ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) return

  if (event.code === 'Space') {
    event.preventDefault()
    toggleSequenceRecording()
    return
  }

  const match = /^Key([QWEASDZXC])$/.exec(event.code)
  if (!match) return

  event.preventDefault()
  const key = match[1].toLowerCase() as PadKey
  const token = 'keyboard:' + key

  beginSamplerInput(key, token)
  keyboardHoldTimers.set(key, window.setTimeout(() => {
    selectSamplerPad(key)
    keyboardHoldTimers.delete(key)
  }, 620))
})

window.addEventListener('keyup', (event) => {
  if (activeExample !== 'sampler') return

  const match = /^Key([QWEASDZXC])$/.exec(event.code)
  if (!match) return

  event.preventDefault()
  const key = match[1].toLowerCase() as PadKey
  const timer = keyboardHoldTimers.get(key)

  if (timer) window.clearTimeout(timer)
  keyboardHoldTimers.delete(key)
  endSamplerInput(key, 'keyboard:' + key)
})

samplerPads.forEach((element) => {
  const key = element.dataset.pad as PadKey

  element.addEventListener('pointerdown', (event) => {
    if (!samplerRunning || (event.pointerType === 'mouse' && event.button !== 0)) return

    event.preventDefault()
    element.setPointerCapture(event.pointerId)
    beginSamplerInput(key, 'pointer:' + event.pointerId)

    const timer = window.setTimeout(() => {
      selectSamplerPad(key)
      const state = pointerHoldStates.get(event.pointerId)
      if (state) state.timer = 0
    }, 620)
    pointerHoldStates.set(event.pointerId, { key, timer })
  })
})

samplerElement.addEventListener('pointerup', (event) => {
  const state = pointerHoldStates.get(event.pointerId)
  if (!state) return

  if (state.timer) window.clearTimeout(state.timer)
  pointerHoldStates.delete(event.pointerId)
  endSamplerInput(state.key, 'pointer:' + event.pointerId)
})

samplerElement.addEventListener('pointercancel', (event) => {
  const state = pointerHoldStates.get(event.pointerId)
  if (!state) return

  if (state.timer) window.clearTimeout(state.timer)
  pointerHoldStates.delete(event.pointerId)
  endSamplerInput(state.key, 'pointer:' + event.pointerId)
})

samplerElement.addEventListener('contextmenu', (event) => {
  if (event.target instanceof Element && event.target.closest('.sampler-pad')) event.preventDefault()
})

samplerSampleButton.addEventListener('click', armSamplerRecording)
samplerLoopRecordButton.addEventListener('click', toggleSequenceRecording)
samplerNewLoopButton.addEventListener('click', createSamplerRecording)

samplerParameterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!selectedPadKey) return

    const pad = samplePadStates.get(selectedPadKey)!
    const direction = Number(button.dataset.direction)

    if (button.dataset.parameter === 'pitch') {
      pad.pitch = Math.max(-12, Math.min(12, pad.pitch + direction))
    } else {
      pad.speed = Math.max(0.5, Math.min(2, Math.round((pad.speed + direction * 0.1) * 10) / 10))
    }

    updateSamplerEditor()
  })
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

Array.from(title).forEach((letter, index) => {
  const lane = document.createElement('div')
  const glyph = document.createElement('span')
  const top = 8 + ((index * 8.7) % 78)
  const duration = 8 + ((index * 1.73) % 7)

  lane.className = 'walker-lane'
  lane.style.setProperty('--top', `${top}%`)
  lane.style.setProperty('--duration', `${duration}s`)
  lane.style.setProperty('--delay', `${index * -1.45}s`)
  lane.style.setProperty('--direction', index % 2 === 0 ? 'alternate' : 'alternate-reverse')

  glyph.className = 'walker'
  glyph.textContent = letter
  glyph.style.setProperty('--step-duration', `${0.38 + (index % 4) * 0.06}s`)
  glyph.style.setProperty('--hue', `${325 + (index % 5) * 8}`)

  lane.append(glyph)
  walkers.append(lane)
})

const heldHearts = new Map<number, HeldHeart>()
const draggedWalkers = new Map<number, DraggedWalker>()
const previousPointerPositions = new Map<number, { x: number; y: number; time: number }>()

const randomBetween = (minimum: number, maximum: number) =>
  minimum + Math.random() * (maximum - minimum)

const createHeart = (x: number, y: number, className: string) => {
  const heart = document.createElement('span')

  heart.className = `effect-particle heart ${className}`
  heart.textContent = '♥'
  heart.setAttribute('aria-hidden', 'true')
  heart.style.left = `${x}px`
  heart.style.top = `${y}px`
  nightSky.append(heart)

  return heart
}

const launchTrailHeart = (x: number, y: number) => {
  const heart = createHeart(x, y, 'heart--floating')
  const startScale = randomBetween(0.55, 1.05)

  heart.style.setProperty('--heart-size', `${randomBetween(18, 31)}px`)
  heart.style.setProperty('--drift', `${randomBetween(-75, 75)}px`)
  heart.style.setProperty('--lift', `${randomBetween(150, 270)}px`)
  heart.style.setProperty('--tilt', `${randomBetween(-18, 18)}deg`)
  heart.style.setProperty('--start-scale', startScale.toFixed(2))
  heart.style.setProperty('--end-scale', (startScale * randomBetween(1.12, 1.45)).toFixed(2))
  heart.style.setProperty('--flight-duration', `${randomBetween(2.1, 3.4)}s`)
  heart.addEventListener('animationend', () => heart.remove(), { once: true })
}

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

const dropWalker = (pointerId: number) => {
  const draggedWalker = draggedWalkers.get(pointerId)

  if (!draggedWalker) return

  const { element, lane } = draggedWalker
  const dropRect = element.getBoundingClientRect()
  const dropX = Math.max(-dropRect.width * 0.5, Math.min(window.innerWidth, dropRect.left))
  const dropY = Math.max(0, Math.min(window.innerHeight - dropRect.height, dropRect.top))
  const targetRight = dropRect.left + dropRect.width / 2 < window.innerWidth / 2
  const travelDistance = targetRight
    ? window.innerWidth - dropRect.left
    : dropRect.left + window.innerWidth * 0.12
  const resumeDuration = Math.max(1.4, travelDistance / 95)

  element.classList.remove('walker--dragged')
  element.style.removeProperty('left')
  element.style.removeProperty('top')
  lane.style.setProperty('--top', `${dropY}px`)
  lane.style.setProperty('--drop-x', `${dropX}px`)
  lane.style.setProperty('--resume-target', targetRight ? 'calc(100vw - 0.8em)' : '-12vw')
  lane.style.setProperty('--resume-duration', `${resumeDuration}s`)
  lane.style.setProperty('--delay', '0s')
  lane.style.setProperty('--direction', targetRight ? 'alternate-reverse' : 'alternate')
  lane.classList.remove('walker-lane--held', 'walker-lane--resuming')
  lane.append(element)

  void lane.offsetWidth
  lane.classList.add('walker-lane--resuming')
  lane.onanimationend = (event) => {
    if (event.animationName !== 'resume-roam') return

    lane.classList.remove('walker-lane--resuming')
    lane.onanimationend = null
  }

  draggedWalkers.delete(pointerId)
}

walkers.addEventListener('pointerdown', (event) => {
  if (activeExample !== 'walker' || event.button !== 0) return

  const target = event.target
  const walker = target instanceof Element ? target.closest<HTMLSpanElement>('.walker') : null
  const lane = walker?.parentElement

  if (!walker || !(lane instanceof HTMLDivElement)) return

  event.preventDefault()
  event.stopPropagation()

  const rect = walker.getBoundingClientRect()

  lane.onanimationend = null
  lane.classList.remove('walker-lane--resuming')
  lane.classList.add('walker-lane--held')
  nightSky.append(walker)
  walker.classList.add('walker--dragged')
  walker.style.left = `${rect.left + rect.width / 2}px`
  walker.style.top = `${rect.top + rect.height / 2}px`
  walker.setPointerCapture(event.pointerId)
  draggedWalkers.set(event.pointerId, {
    element: walker,
    lane,
    offsetX: rect.left + rect.width / 2 - event.clientX,
    offsetY: rect.top + rect.height / 2 - event.clientY,
  })
})

window.addEventListener('pointermove', (event) => {
  const draggedWalker = draggedWalkers.get(event.pointerId)

  if (!draggedWalker) return

  event.preventDefault()
  draggedWalker.element.style.left = `${event.clientX + draggedWalker.offsetX}px`
  draggedWalker.element.style.top = `${event.clientY + draggedWalker.offsetY}px`
})

const growHeldHeart = (pointerId: number) => {
  const heldHeart = heldHearts.get(pointerId)

  if (!heldHeart) return

  const heldFor = performance.now() - heldHeart.startedAt
  const scale = 1 + heldFor / 900

  heldHeart.element.style.transform = `translate(-50%, -50%) scale(${scale})`
  heldHeart.element.style.setProperty('--current-scale', scale.toFixed(3))
  heldHeart.animationFrame = requestAnimationFrame(() => growHeldHeart(pointerId))
}

const launchHeldHeart = (pointerId: number) => {
  const heldHeart = heldHearts.get(pointerId)

  if (!heldHeart) return

  cancelAnimationFrame(heldHeart.animationFrame)

  const currentScale = Number(heldHeart.element.style.getPropertyValue('--current-scale')) || 1

  heldHeart.element.style.removeProperty('transform')
  heldHeart.element.style.setProperty('--release-scale', currentScale.toFixed(3))
  heldHeart.element.style.setProperty('--release-end-scale', (currentScale * 1.13).toFixed(3))
  heldHeart.element.style.setProperty('--drift', `${randomBetween(-110, 110)}px`)
  heldHeart.element.style.setProperty('--lift', `${Math.max(window.innerHeight * 0.8, 520)}px`)
  heldHeart.element.style.setProperty('--tilt', `${randomBetween(-14, 14)}deg`)
  heldHeart.element.classList.remove('heart--growing')
  heldHeart.element.classList.add('heart--released')
  heldHeart.element.addEventListener('animationend', () => heldHeart.element.remove(), { once: true })
  heldHearts.delete(pointerId)
}

nightSky.addEventListener('pointermove', (event) => {
  if (activeExample === 'gaze') {
    scheduleGaze(event.clientX, event.clientY)
    return
  }
  if (activeExample !== 'heart') return
  if (event.target instanceof Node && controls.contains(event.target)) return

  const previous = previousPointerPositions.get(event.pointerId)
  const now = performance.now()
  const movedFarEnough =
    !previous || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >= 6
  const waitedLongEnough = !previous || now - previous.time >= 20

  if (movedFarEnough && waitedLongEnough) {
    if (activeExample === 'heart') launchTrailHeart(event.clientX, event.clientY)

    previousPointerPositions.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      time: now,
    })
  }
})

nightSky.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    activeExample === 'sampler' ||
    activeExample === 'claw' ||
    activeExample === 'lemonade' ||
    activeExample === 'water' ||
    activeExample === 'balloon' ||
    activeExample === 'doodle-face' ||
    activeExample === 'rubber-human' ||
    activeExample === 'shampoo' ||
    activeExample === 'animal-forest' ||
    activeExample === 'animal-forest-extended' ||
    activeExample === 'animal-forest-edition' ||
    heldHearts.has(event.pointerId) ||
    (event.target instanceof Node && controls.contains(event.target))
  ) {
    return
  }

  event.preventDefault()

  if (
    activeExample === 'walker' ||
    activeExample === 'typing'
  ) return

  if (activeExample === 'gaze') {
    winkAt(event.clientX, event.clientY)
    return
  }

  const heart = createHeart(event.clientX, event.clientY, 'heart--growing')
  const heldHeart: HeldHeart = {
    element: heart,
    startedAt: performance.now(),
    animationFrame: 0,
  }

  heart.style.setProperty('--heart-size', '44px')
  heart.style.setProperty('--current-scale', '1')
  heldHearts.set(event.pointerId, heldHeart)
  nightSky.setPointerCapture(event.pointerId)
  growHeldHeart(event.pointerId)
})

window.addEventListener('pointerup', (event) => {
  dropWalker(event.pointerId)
  if (event.button === 0) launchHeldHeart(event.pointerId)
})

window.addEventListener('pointercancel', (event) => {
  dropWalker(event.pointerId)
  launchHeldHeart(event.pointerId)
})

window.addEventListener('blur', () => {
  draggedWalkers.forEach((_, pointerId) => dropWalker(pointerId))
  heldHearts.forEach((_, pointerId) => launchHeldHeart(pointerId))
  releaseAllSamplerInputs()
})

const setExampleRenderingActive = (mode: ExampleMode) => {
  examplePanels.forEach((panel) => {
    const isActive = panel.dataset.examplePanel === mode

    panel.hidden = !isActive
    panel.inert = !isActive
    panel.setAttribute('aria-hidden', String(!isActive))
  })

  walkers.hidden = mode !== 'walker'
  stars.hidden = mode === 'typing' || mode === 'claw' || mode === 'sampler' || mode === 'lemonade' || mode === 'water' || mode === 'balloon' || mode === 'doodle-face' || mode === 'rubber-human' || mode === 'shampoo' || mode === 'animal-forest' || mode === 'animal-forest-extended' || mode === 'animal-forest-edition'
}

setExampleRenderingActive(activeExample)

exampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextExample = button.dataset.example as ExampleMode

    if (nextExample === activeExample) return

    activeExample = nextExample
    capture.invalidate()
    nightSky.dataset.example = activeExample
    setExampleRenderingActive(activeExample)
    previousPointerPositions.clear()
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

    if (activeExample === 'sampler') {
      startSampler()
    } else {
      stopSampler()
    }

    if (activeExample === 'gaze') {
      const rect = gazeOrb.getBoundingClientRect()

      updateGaze(rect.left + rect.width / 2, rect.top + rect.height / 2)
    } else {
      window.clearTimeout(expressionTimer)
      gazeCharacter.dataset.expression = 'neutral'
    }

    draggedWalkers.forEach((_, pointerId) => dropWalker(pointerId))
    document.querySelectorAll<HTMLElement>('.effect-particle').forEach((particle) => particle.remove())
    heldHearts.forEach((heldHeart) => cancelAnimationFrame(heldHeart.animationFrame))
    heldHearts.clear()

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
