import { createClient } from '@supabase/supabase-js'
import type { GuestbookEntry } from './model.ts'
import { PAGE_SIZE } from './model.ts'

export function createGuestbookApi(url: string, key: string) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const columns = 'id,name,message,created_at'
  return {
    async list(before?: GuestbookEntry) {
      let query = client.from('guestbook_entries').select(columns)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE)
      if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`)
      const { data, error } = await query.abortSignal(AbortSignal.timeout(15000))
      if (error) throw error
      return data as GuestbookEntry[]
    },
    async insert(entry: { id: string; name: string; message: string }) {
      const { data, error } = await client.from('guestbook_entries').insert(entry)
        .select(columns).abortSignal(AbortSignal.timeout(15000)).single()
      // A timed-out request may already have committed. Reuse its UUID on retry.
      if (error?.code === '23505') {
        const existing = await client.from('guestbook_entries').select(columns).eq('id', entry.id)
          .abortSignal(AbortSignal.timeout(15000)).single()
        if (existing.error) throw existing.error
        return existing.data as GuestbookEntry
      }
      if (error) throw error
      return data as GuestbookEntry
    },
    subscribe(onInsert: (entry: GuestbookEntry) => void, onStatus: (connected: boolean) => void) {
      const channel = client.channel('guestbook-wall')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guestbook_entries' },
          payload => onInsert(payload.new as GuestbookEntry))
        .subscribe(status => onStatus(status === 'SUBSCRIBED'))
      return () => { void client.removeChannel(channel) }
    },
  }
}
