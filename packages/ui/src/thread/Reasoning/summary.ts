/*
 * What a thought was about, in a line, from its own words: no model is asked.
 *
 * Codex thinks in summaries its model writes, each part under a heading of
 * its own in bold (`**Tracing the poll**`), as OpenAI's reasoning summaries
 * are; as Codex's own terminal does (chatwidget/streaming.rs,
 * latest_summary_line), the latest whole heading is what it is on. Claude
 * Code and OpenCode give the thinking itself: its first sentence says what
 * it set out to do.
 */

/**
 * The words of a line that is a heading and nothing else, bold as Codex's are or a markdown heading, a colon after it or
 * not: null for any other. Trimmed first, so no pattern has spaces to read two ways, as one for the whole line would.
 */
const headingIn = (line: string): string | null => {
  const trimmed = line.trim()
  const whole = trimmed.endsWith(':') ? trimmed.slice(0, -1).trimEnd() : trimmed
  if (whole.length > 4 && whole.startsWith('**') && whole.endsWith('**')) {
    const words = whole.slice(2, -2)
    return words.includes('*') ? null : words
  }
  const hashes = /^#{1,6}\s/.exec(whole)?.[0]
  return hashes === undefined ? null : whole.slice(hashes.length)
}

/** How long the line may be, in characters. */
const LONG = 90

/** Words a thought may open with that say nothing of what it is about. */
const FILLER = /^(?:okay|ok|alright|all right|so|hmm+|now|right|well)[,.:!]?\s+/i

const plain = (text: string) =>
  text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const short = (line: string) => {
  if (line.length <= LONG) return line
  const cut = line.slice(0, LONG - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > LONG / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, '')}…`
}

/** The latest whole heading in a thought, as its model titled what it is on: null where it has none. */
export const headingOf = (text: string): string | null => {
  const lines = text.split('\n')
  // A last line not yet ended may still be a heading being written: only one that is whole counts.
  for (let at = lines.length - 1; at >= 0; at--) {
    const words = headingIn(lines[at] ?? '')
    if (words !== null && plain(words) !== '') return short(plain(words))
  }
  return null
}

/** What a thought was about, in a line: its latest heading, or else its first sentence, short. Empty for a thought with no words. */
export const thoughtSummary = (text: string): string => {
  const heading = headingOf(text)
  if (heading !== null) return heading
  const first = plain(text.trim().split(/\n\s*\n/)[0] ?? '').replace(FILLER, '')
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(first)?.[1] ?? first
  const said = short(sentence).replace(/\.$/, '')
  return said.length > 0 ? `${said[0]?.toUpperCase() ?? ''}${said.slice(1)}` : ''
}
