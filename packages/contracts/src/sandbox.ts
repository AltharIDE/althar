/*
 * What a lead's sandbox lets through from the start, as the person writes
 * it in the project's rules: commands by how they start, and hosts by name.
 */

/**
 * A host as a sandbox's list takes it: its name alone, in lower case, from
 * an address or a name with a port; `*.` before it for every host under it.
 * Null for what isn't a host's name.
 */
export const hostOf = (typed: string): string | null => {
  const words = typed.trim().toLowerCase()
  const wild = words.startsWith('*.')
  const rest = wild ? words.slice(2) : words
  if (rest === '') return null
  let name: string
  try {
    name = new URL(rest.includes('://') ? rest : `https://${rest}`).hostname
  } catch {
    return null
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) && name !== 'localhost') return null
  return wild ? `*.${name}` : name
}

/** A command as a sandbox's list takes it: how it starts, its words with single spaces; null for nothing. */
export const commandStartOf = (typed: string): string | null => {
  const words = typed.trim().replace(/\s+/g, ' ').replace(/ \*$/, '')
  return words === '' || words === '*' ? null : words
}
