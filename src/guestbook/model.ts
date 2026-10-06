export type GuestbookEntry = { id: string; name: string; message: string; created_at: string }
export const NAME_LIMIT = 30
export const MESSAGE_LIMIT = 500
export const PAGE_SIZE = 30

export function validateEntry(name: string, message: string) {
  const value = { name: name.trim(), message: message.trim() }
  if (!value.name) throw new Error('이름을 입력해 주세요.')
  if (!value.message) throw new Error('하고 싶은 말을 입력해 주세요.')
  if (value.name.length > NAME_LIMIT) throw new Error(`이름은 ${NAME_LIMIT}자까지 입력할 수 있어요.`)
  if (value.message.length > MESSAGE_LIMIT) throw new Error(`내용은 ${MESSAGE_LIMIT}자까지 입력할 수 있어요.`)
  return value
}

export function mergeEntries(current: GuestbookEntry[], incoming: GuestbookEntry[]) {
  const entries = new Map(current.map(entry => [entry.id, entry]))
  incoming.forEach(entry => entries.set(entry.id, entry))
  return [...entries.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
}

// Catch up across multiple pages after a busy period or a lost connection.
export async function fetchRecentEntries(
  readPage: (before?: GuestbookEntry) => Promise<GuestbookEntry[]>,
  knownNewest?: GuestbookEntry,
) {
  let page = await readPage()
  const result = [...page]
  while (knownNewest && page.length === PAGE_SIZE) {
    const last = page.at(-1)!
    const isNewer = last.created_at > knownNewest.created_at
      || (last.created_at === knownNewest.created_at && last.id > knownNewest.id)
    if (!isNewer) break
    page = await readPage(last)
    result.push(...page)
  }
  return result
}

export function publicConfig(url: string, key: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    if (url.includes('YOUR_PROJECT') || key.includes('REPLACE_ME')) return null
    if (key.startsWith('sb_publishable_') && key.length > 20) return { url, key }
    // Legacy anon keys remain supported; reject elevated service_role JWTs.
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'anon' ? { url, key } : null
  } catch { return null }
}
