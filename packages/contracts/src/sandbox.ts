/*
 * What a lead's sandbox lets through from the start, as the person writes
 * it in the project's rules: commands by how they start, and hosts by name.
 */

/**
 * A host as a sandbox's list takes it: its name alone, in lower case, from
 * an address or a name with a port. Null for what isn't one host's name: a
 * `*.` for every host under one isn't, as the rules judge a request by the
 * host it names, and couldn't each host it would let through.
 */
export const hostOf = (typed: string): string | null => {
  const words = typed.trim().toLowerCase()
  if (words === '' || words.includes('*')) return null
  let name: string
  try {
    name = new URL(words.includes('://') ? words : `https://${words}`).hostname
  } catch {
    return null
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) || name === 'localhost' ? name : null
}

/** A command as a sandbox's list takes it: how it starts, its words with single spaces; null for nothing. */
export const commandStartOf = (typed: string): string | null => {
  const words = typed.trim().replace(/\s+/g, ' ').replace(/ \*$/, '')
  return words === '' || words === '*' ? null : words
}
