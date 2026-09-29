export function normalizeResidentName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 20).join('')
}

export function nextResidentName(names: Iterable<string>): string {
  const used = new Set(names)
  let number = 1
  while (used.has(`주민 ${number}`)) number++
  return `주민 ${number}`
}

// Reserve every existing name first, including names later in the list.
export function assignResidentNames<T extends { name?: string }>(residents: T[]): (T & { name: string })[] {
  const used = new Set(residents.map(r => normalizeResidentName(r.name)).filter(Boolean))
  return residents.map(resident => {
    const name = normalizeResidentName(resident.name) || nextResidentName(used)
    used.add(name)
    return { ...resident, name }
  })
}
