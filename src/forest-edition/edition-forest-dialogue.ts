import { createForestDialogueDeck } from './edition-forest-dialogue-lines'
import './edition-forest-dialogue.css'

export function createForestDialogue(root: HTMLElement) {
  const bubble = document.createElement('button'); bubble.type = 'button'; bubble.className = 'edition-forest-dialogue'; bubble.hidden = true
  bubble.innerHTML = `<svg class="edition-forest-dialogue__shape" viewBox="0 0 760 210" preserveAspectRatio="none" aria-hidden="true"><path d="M65 13 C170 -1 540 1 648 12 C710 17 751 36 754 69 C758 93 743 108 741 125 C736 145 755 167 726 188 C700 209 582 205 411 207 C248 211 103 208 57 196 C21 187 10 170 18 146 C23 129 5 111 6 83 C5 49 23 24 65 13Z"/></svg>
    <span class="edition-forest-dialogue__name" aria-hidden="true"></span><span class="edition-forest-dialogue__text" aria-hidden="true"></span><span class="edition-forest-dialogue__next" aria-hidden="true">▾</span>`
  const announcement = document.createElement('p'); announcement.className = 'edition-forest-dialogue__announcement'; announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true')
  root.append(bubble, announcement)
  const nameTag = bubble.querySelector<HTMLElement>('.edition-forest-dialogue__name')!
  const text = bubble.querySelector<HTMLElement>('.edition-forest-dialogue__text')!
  const decks = new Map<string, ReturnType<typeof createForestDialogueDeck>>()
  let speaker: { id: string; name: string; lines?: readonly string[]; lastLine: number } | null = null
  let letters: string[] = []; let at = 0; let delay = 0; let pause = 0
  function finish() {
    if (!speaker) return
    at = letters.length; text.textContent = letters.join(''); bubble.classList.add('is-complete')
    root.dataset.dialogueState = 'complete'; pause = Math.max(5500, letters.length * 110)
    announcement.textContent = `${speaker.name}: ${text.textContent}`
    bubble.setAttribute('aria-label', `${speaker.name}의 다음 이야기 듣기`)
  }
  function next() {
    if (!speaker) return
    let draw = decks.get(speaker.id)
    if (!draw) { draw = createForestDialogueDeck(); decks.set(speaker.id, draw) }
    // Segmenter preserves composed Hangul and multi-code-point characters.
    let line: string
    if (speaker.lines?.length) {
      const choices = speaker.lines.map((_, i) => i).filter(i => i !== speaker!.lastLine)
      speaker.lastLine = choices[Math.floor(Math.random() * choices.length)] ?? 0
      line = speaker.lines[speaker.lastLine]
    } else line = draw()
    letters = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(line)].map(s => s.segment)
    at = 0; delay = 180; pause = 0; text.textContent = ''; announcement.textContent = ''
    bubble.classList.remove('is-complete'); root.dataset.dialogueState = 'typing'
    bubble.setAttribute('aria-label', `${speaker.name}의 이야기 · 누르면 전체 보기`)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish()
  }
  bubble.onclick = () => { if (at < letters.length) finish(); else next() }
  return {
    show(id: string, name: string, lines?: readonly string[]) {
      speaker = { id, name, lines, lastLine: -1 }; nameTag.textContent = name; nameTag.title = name; bubble.hidden = false
      bubble.classList.toggle('is-animal', !!lines)
      root.dataset.dialogueResident = name; next()
      bubble.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(14px) scale(.97)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
    },
    hide() { speaker = null; bubble.hidden = true; text.textContent = ''; announcement.textContent = ''; root.dataset.dialogueState = 'hidden'; delete root.dataset.dialogueResident },
    update(dt: number) {
      if (!speaker || document.hidden) return
      const ms = Math.min(dt, .1) * 1000
      if (at >= letters.length) { pause -= ms; if (pause <= 0) next(); return }
      delay -= ms
      if (delay > 0) return
      const letter = letters[at++]; text.textContent = letters.slice(0, at).join('')
      delay += /[.!?…]/u.test(letter) ? 290 : /[,，]/u.test(letter) ? 150 : /\s/u.test(letter) ? 22 : 38 + Math.random() * 25
      if (at === letters.length) finish()
    },
  }
}
