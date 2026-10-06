import './style.css'
import { createGuestbookApi } from './api'
import { mergeEntries, validateEntry, publicConfig, fetchRecentEntries, PAGE_SIZE } from './model'
import type { GuestbookEntry } from './model'

const config = publicConfig(
  import.meta.env.VITE_SUPABASE_URL?.trim() ?? '',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
)

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="page-header">
    <a class="back-link" href="${import.meta.env.BASE_URL}">← 워크숍으로</a>
    <span>VIBE CODING WORKSHOP</span>
  </header>
  <main class="guestbook">
    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">A LITTLE NOTE, A LITTLE CONNECTION</p>
      <h1 id="page-title">당신의 한마디를<br><em>붙여 주세요.</em></h1>
      <p>오늘의 발견, 작은 인사, 하고 싶은 이야기.<br>우리의 워크숍에 당신의 흔적을 남겨 주세요.</p>
    </section>
    <div class="guestbook-layout">
      <aside class="composer">
        <form id="guestbook-form">
          <div class="composer-heading"><span aria-hidden="true">✎</span><h2>방명록 남기기</h2></div>
          <fieldset id="entry-fields">
            <label for="guest-name">이름 <small>최대 30자</small></label>
            <input id="guest-name" name="name" autocomplete="nickname" maxlength="30" placeholder="어떤 이름으로 남길까요?" required />
            <label for="guest-message">하고 싶은 말</label>
            <textarea id="guest-message" name="message" rows="6" maxlength="500" placeholder="여기에 마음을 남겨 주세요 :)" aria-describedby="message-count" required></textarea>
            <div class="character-count" id="message-count">0 / 500</div>
            <button class="submit-button" type="submit">작성하기 <span aria-hidden="true">↗</span></button>
          </fieldset>
          <p class="privacy-note">이름과 내용은 모든 방문자에게 공개돼요.</p>
          <p id="form-status" class="status" role="status" aria-live="polite"></p>
        </form>
      </aside>
      <section class="wall" aria-labelledby="wall-title" aria-busy="true">
        <div class="wall-heading"><h2 id="wall-title">우리의 방명록 <span id="note-count"></span></h2>
          <button id="refresh" type="button">새로고침 ↻</button></div>
        <p id="connection-status" class="connection-status" role="status">연결하는 중…</p>
        <p id="list-status" class="status" role="status">방명록을 불러오는 중…</p>
        <ul id="note-list" class="note-grid" aria-label="방명록 목록"></ul>
        <button id="load-more" class="load-more" type="button" hidden>이전 방명록 더 보기 ↓</button>
      </section>
    </div>
    <footer class="page-footer">작은 메모들이 모여, 우리의 이야기가 됩니다.</footer>
  </main>
`

const form = document.querySelector<HTMLFormElement>('#guestbook-form')!
const fields = document.querySelector<HTMLFieldSetElement>('#entry-fields')!
const nameInput = document.querySelector<HTMLInputElement>('#guest-name')!
const messageInput = document.querySelector<HTMLTextAreaElement>('#guest-message')!
const submit = document.querySelector<HTMLButtonElement>('.submit-button')!
const formStatus = document.querySelector<HTMLElement>('#form-status')!
const listStatus = document.querySelector<HTMLElement>('#list-status')!
const connectionStatus = document.querySelector<HTMLElement>('#connection-status')!
const list = document.querySelector<HTMLUListElement>('#note-list')!
const wall = document.querySelector<HTMLElement>('.wall')!
const more = document.querySelector<HTMLButtonElement>('#load-more')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const api = config ? createGuestbookApi(config.url, config.key) : null
let entries: GuestbookEntry[] = []
let cursor: GuestbookEntry | undefined
let loading = false
let saving = false
let pending: { id: string; name: string; message: string } | undefined
let unsubscribe: (() => void) | undefined
let poll: ReturnType<typeof setInterval> | undefined

function render(incoming: GuestbookEntry[], animate: boolean) {
  const previous = new Set(entries.map(entry => entry.id))
  entries = mergeEntries(entries, incoming)
  const nodes = new Map([...list.children].map(node => [(node as HTMLElement).dataset.id, node as HTMLElement]))
  for (const [index, entry] of entries.entries()) {
    let note = nodes.get(entry.id)
    if (!note) {
      note = document.createElement('li')
      const seed = [...entry.id].reduce((sum, char) => sum + char.charCodeAt(0), 0)
      note.className = `note note--${seed % 5}${animate && !previous.has(entry.id) ? ' note--new' : ''}`
      note.dataset.id = entry.id
      note.addEventListener('animationend', () => note!.classList.remove('note--new'), { once: true })
      note.style.setProperty('--tilt', `${(seed % 7 - 3) * 0.65}deg`)
      const message = document.createElement('p')
      message.className = 'note-message'
      message.textContent = entry.message
      const author = document.createElement('strong')
      author.textContent = entry.name
      const time = document.createElement('time')
      time.dateTime = entry.created_at
      time.textContent = dateFormat.format(new Date(entry.created_at))
      note.append(message, author, time)
    }
    // Reuse nodes so typing, focus, and existing note animations are preserved.
    if (list.children[index] !== note) list.insertBefore(note, list.children[index] ?? null)
  }
  document.querySelector('#note-count')!.textContent = `${entries.length}개의 메모`
  if (entries.length) listStatus.textContent = ''
}

async function load(older = false) {
  if (!api || loading) return
  loading = true
  wall.setAttribute('aria-busy', 'true')
  refresh.disabled = more.disabled = true
  try {
    const rows = older ? await api.list(cursor) : await fetchRecentEntries(api.list, entries[0])
    render(rows, entries.length > 0 && !older)
    if (older || !cursor) {
      cursor = rows.at(-1) ?? cursor
      more.hidden = rows.length < PAGE_SIZE
    }
    listStatus.textContent = entries.length ? '' : '아직 붙여진 메모가 없어요. 첫 번째 인사를 남겨 주세요!'
    listStatus.dataset.error = 'false'
  } catch {
    listStatus.textContent = '방명록을 불러오지 못했어요. 연결을 확인하고 새로고침을 눌러 주세요.'
    listStatus.dataset.error = 'true'
  } finally {
    loading = false
    wall.setAttribute('aria-busy', 'false')
    refresh.disabled = more.disabled = false
  }
}

messageInput.addEventListener('input', () => {
  document.querySelector('#message-count')!.textContent = `${messageInput.value.length} / 500`
})
form.addEventListener('submit', async event => {
  event.preventDefault()
  if (!api || saving) return
  try {
    const value = validateEntry(nameInput.value, messageInput.value)
    if (!pending || pending.name !== value.name || pending.message !== value.message) {
      pending = { id: crypto.randomUUID(), ...value }
    }
    saving = true
    fields.disabled = true
    submit.textContent = '붙이는 중…'
    formStatus.textContent = '방명록을 저장하고 있어요.'
    formStatus.dataset.error = 'false'
    const entry = await api.insert(pending)
    render([entry], true)
    pending = undefined
    messageInput.value = ''
    document.querySelector('#message-count')!.textContent = '0 / 500'
    formStatus.textContent = '당신의 메모가 붙었어요. 남겨 주셔서 고마워요!'
  } catch (error) {
    formStatus.textContent = saving
      ? '저장을 확인하지 못했어요. 입력 내용은 그대로예요. 연결을 확인한 뒤 다시 작성하기를 눌러 주세요.'
      : error instanceof Error ? error.message : '입력 내용을 확인해 주세요.'
    formStatus.dataset.error = 'true'
  } finally {
    saving = false
    fields.disabled = false
    submit.innerHTML = '작성하기 <span aria-hidden="true">↗</span>'
  }
})
refresh.addEventListener('click', () => { void load() })
more.addEventListener('click', () => { void load(true) })

function connect() {
  if (!api || unsubscribe) return
  unsubscribe = api.subscribe(entry => render([entry], true), connected => {
    connectionStatus.textContent = connected ? '● 새로운 메모를 실시간으로 받고 있어요' : '○ 연결을 확인하는 중 · 주기적으로 새 메모를 확인해요'
    connectionStatus.dataset.connected = String(connected)
    if (connected) void load()
  })
  // Also recover missed events after suspension or a temporary WebSocket outage.
  poll = setInterval(() => { if (!document.hidden) void load() }, 30000)
  void load()
}
if (api) {
  connect()
  window.addEventListener('online', () => { void load() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void load() })
  window.addEventListener('pagehide', () => {
    unsubscribe?.()
    unsubscribe = undefined
    clearInterval(poll)
  })
  window.addEventListener('pageshow', () => connect())
} else {
  fields.disabled = true
  refresh.disabled = true
  wall.setAttribute('aria-busy', 'false')
  connectionStatus.textContent = '방명록을 준비하고 있어요'
  listStatus.textContent = '아직 방명록 연결이 완료되지 않았어요. 잠시 후 다시 방문해 주세요.'
  formStatus.textContent = '연결이 완료되면 메모를 남길 수 있어요.'
}
