import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEntry, mergeEntries, publicConfig, fetchRecentEntries } from '../src/guestbook/model.ts'
import { createGuestbookApi } from '../src/guestbook/api.ts'

const entry = { id: '1cbe7a42-e644-402e-acf6-43404614a401', name: '방문자', message: '반가워요!\n또 올게요.', created_at: '2026-10-06T12:00:00.000Z' }

test('guestbook rejects blank/oversized input and preserves line breaks and literal markup', () => {
  assert.throws(() => validateEntry(' \n ', 'hello'))
  assert.throws(() => validateEntry('이름', '\t\n'))
  assert.throws(() => validateEntry('가'.repeat(31), 'hello'))
  assert.throws(() => validateEntry('이름', '가'.repeat(501)))
  assert.deepEqual(validateEntry(' 방문자 ', ' <script>alert(1)</script>\n반가워요 '), {
    name: '방문자', message: '<script>alert(1)</script>\n반가워요',
  })
  assert.equal(validateEntry('가'.repeat(30), '가'.repeat(500)).message.length, 500)
})

test('guestbook merges INSERT echo and fetch without duplicates or losing concurrent entries', () => {
  const older = { ...entry, id: 'older', created_at: '2026-10-05T12:00:00.000Z' }
  const newer = { ...entry, id: 'newer', created_at: '2026-10-07T12:00:00.000Z' }
  const current = mergeEntries([entry], [entry, newer])
  assert.deepEqual(mergeEntries(current, [older, entry]).map(row => row.id), ['newer', entry.id, 'older'])
  assert.equal(current.length, 2)
})

test('guestbook accepts only HTTPS public config and rejects placeholders and elevated keys', () => {
  const url = 'https://example.supabase.co'
  const key = 'sb_publishable_example_test_key'
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
  assert.deepEqual(publicConfig(url, key), { url, key })
  assert.ok(publicConfig(url, jwt('anon')))
  for (const bad of ['', 'sb_secret_test', jwt('service_role'), 'sb_publishable_REPLACE_ME']) {
    assert.equal(publicConfig(url, bad), null)
  }
  assert.equal(publicConfig('http://example.supabase.co', key), null)
  assert.equal(publicConfig('https://YOUR_PROJECT_REF.supabase.co', key), null)
})

test('guestbook uses server-returned row, stable retry UUID, and cursor pagination', async t => {
  const requests = []
  const responses = [
    [201, entry],
    [409, { code: '23505', message: 'duplicate key' }],
    [200, entry],
    [200, [entry]],
    [403, { code: '42501', message: 'row-level security' }],
  ]
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), options })
    const [status, body] = responses.shift()
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const api = createGuestbookApi('https://example.supabase.co', 'sb_publishable_example_test_key')
  const input = { id: entry.id, name: entry.name, message: entry.message }
  assert.deepEqual(await api.insert(input), entry)
  assert.deepEqual(await api.insert(input), entry)
  assert.deepEqual(await api.list(entry), [entry])
  await assert.rejects(api.insert(input), error => error.code === '42501')
  assert.deepEqual(JSON.parse(requests[0].options.body), input)
  assert.equal(requests[2].url.searchParams.get('id'), `eq.${entry.id}`)
  assert.equal(requests[3].url.searchParams.get('order'), 'created_at.desc,id.desc')
  assert.match(requests[3].url.searchParams.get('or'), /created_at.lt.*id.lt/)
})


test('guestbook catches up more than one page of missed inserts without a pagination gap', async () => {
  const rows = Array.from({ length: 66 }, (_, index) => ({
    ...entry, id: String(99 - index).padStart(3, '0'),
  }))
  const cursors = []
  const read = async before => {
    cursors.push(before?.id)
    const start = before ? rows.findIndex(row => row.id === before.id) + 1 : 0
    return rows.slice(start, start + 30)
  }
  assert.equal((await fetchRecentEntries(read)).length, 30)
  cursors.length = 0
  assert.deepEqual(await fetchRecentEntries(read, rows[65]), rows)
  assert.deepEqual(cursors, [undefined, rows[29].id, rows[59].id])
  cursors.length = 0
  assert.equal((await fetchRecentEntries(read, rows[0])).length, 30)
  assert.equal(cursors.length, 1)
})
