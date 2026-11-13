/*
 * How a word typed matches a piece of text, forgiving as the best searches
 * are: the start of a word first ("lig" in "lightbox"), then the first
 * letters of words in order ("scf" in "small changes fast"), then letters
 * in order with gaps ("ligbx"), then anywhere inside a word. Each says how
 * well it matched and which letters did, so a row can draw them darker.
 */

/** Where in the text the letters that matched are, as [from, to) pairs. */
export type Ranges = ReadonlyArray<readonly [number, number]>

export interface Hit {
  readonly score: number
  readonly ranges: Ranges
}

/** Lower case, accents and curly quotes plain, one character in for one out, so positions hold in the original. */
export const fold = (text: string) => prepare(text).text

function keep(text: string) {
  return Array.from(text, (char) => {
    const plain = char
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    return plain.length === 1 ? plain.replace(/[’‘]/, "'").replace(/[“”]/, '"') : char.toLowerCase()
  }).join('')
}

const wordy = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

/** Where each word starts: after anything that isn't a letter or digit, or at a capital inside one (camelCase, a path). */
const startsOf = (text: string, raw: string) => {
  const starts: Array<number> = []
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (!wordy(char)) continue
    const before = raw[at - 1]
    const upper = raw[at] !== undefined && raw[at] !== text[at] && before !== undefined && wordy(before) && before === text[at - 1]
    if (at === 0 || !wordy(text[at - 1]) || upper) starts.push(at)
  }
  return starts
}

const merge = (ranges: Array<[number, number]>): Ranges => {
  const sorted = ranges.sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const one of sorted) {
    const last = out.at(-1)
    if (last !== undefined && one[0] <= last[1]) last[1] = Math.max(last[1], one[1])
    else out.push([one[0], one[1]])
  }
  return out
}

/** Each text folded and its words' starts, worked out once: a search reads the same texts on every key. */
const prepared = new Map<string, { readonly text: string; readonly starts: ReadonlyArray<number> }>()
export const clearPrepared = () => prepared.clear()
const prepare = (raw: string) => {
  let one = prepared.get(raw)
  if (one === undefined) {
    const text = keep(raw)
    one = { text, starts: startsOf(text, raw) }
    prepared.set(raw, one)
  }
  return one
}

/** How one word typed matches `raw`, or null where it doesn't. */
export const matchWord = (raw: string, word: string, fuzzy = true): Hit | null => {
  if (word === '') return null
  const { text, starts } = prepare(raw)
  // The start of a word: the strongest, more so at the very start and where it is the whole word.
  for (const at of starts) {
    if (!text.startsWith(word, at)) continue
    const whole = !wordy(text[at + word.length])
    return { score: 10 + (at === 0 ? 3 : 0) + (whole ? 2 : 0) + Math.min(word.length, 6) / 3, ranges: [[at, at + word.length]] }
  }
  // A plural or a tense typed finds the word it comes from: "refunds" finds "refund", "merged" "merge".
  const stem = word.replace(/(es|s|ed|ing)$/, '')
  if (stem !== word && stem.length >= 3)
    for (const at of starts) if (text.startsWith(stem, at)) return { score: 9.5, ranges: [[at, at + stem.length]] }
  // Punctuation typed, as in a path or a key (src/fin, dev-5): anywhere it starts.
  if (/[^\p{L}\p{N}]/u.test(word)) {
    const at = text.indexOf(word)
    if (at >= 0) return { score: 9, ranges: [[at, at + word.length]] }
  }
  if (!fuzzy || word.length < 2) return null
  // The first letters of words, in order: "scf" for small changes fast, "lll" for let leads listen.
  if (word.length >= 2 && word.length <= 6) {
    const ranges: Array<[number, number]> = []
    let from = 0
    for (const char of word) {
      const at = starts.find((start) => start >= from && text[start] === char)
      if (at === undefined) break
      ranges.push([at, at + 1])
      from = at + 1
    }
    if (ranges.length === word.length) return { score: 8 + word.length / 2, ranges }
  }
  // Inside a word.
  const inside = text.indexOf(word)
  if (inside >= 0 && word.length >= 3) return { score: 5, ranges: [[inside, inside + word.length]] }
  // Letters in order, with gaps, starting at a word: the fewer and shorter the gaps, the better.
  if (word.length >= 3) {
    for (const start of starts) {
      if (text[start] !== word[0]) continue
      const ranges: Array<[number, number]> = [[start, start + 1]]
      let at = start + 1
      let gaps = 0
      let ok = true
      for (const char of word.slice(1)) {
        const next = text.indexOf(char, at)
        // Within the same few words: a match spread over a whole message is noise.
        if (next < 0 || next - at > 12) {
          ok = false
          break
        }
        if (next > at) gaps += 1
        ranges.push([next, next + 1])
        at = next + 1
      }
      // Close together: letters strewn over a whole line are noise.
      if (ok && at - start <= word.length * 4) return { score: Math.max(1, 6 - gaps), ranges: merge(ranges) }
    }
  }
  return null
}

/** The words typed, folded; quotes and the scope's own prefix are the caller's. */
export const wordsOf = (query: string) =>
  fold(query)
    .split(/\s+/)
    .map((word) => word.replace(/^["']+|["'?.,!]+$/g, ''))
    .filter(Boolean)

export { merge }

/** A stretch of text, the parts that matched marked, as a row draws it. */
export interface Part {
  readonly text: string
  readonly hit: boolean
}

/** Text cut into parts at the ranges that matched. */
export const partsOf = (text: string, ranges: Ranges): ReadonlyArray<Part> => {
  const parts: Array<Part> = []
  let at = 0
  for (const [from, to] of ranges) {
    if (from > at) parts.push({ text: text.slice(at, from), hit: false })
    parts.push({ text: text.slice(from, to), hit: true })
    at = to
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts
}

/** Every place a word typed starts a word in the text, its stem too: "rebasing" marks "rebase" and "rebasing". */
const everyHit = (raw: string, word: string): Array<readonly [number, number]> => {
  const { text, starts } = prepare(raw)
  const stem = word.replace(/(es|s|ed|ing)$/, '')
  const want = stem !== word && stem.length >= 3 ? stem : word
  const out: Array<readonly [number, number]> = []
  for (const at of starts) {
    if (!text.startsWith(want, at)) continue
    // The whole word, as far as it goes.
    let end = at + want.length
    while (end < text.length && wordy(text[end])) end += 1
    out.push([at, text.startsWith(word, at) ? at + word.length : end])
  }
  return out
}

/**
 * A passage of a longer text around where the words matched: `around`
 * characters either side, cut at words, with ellipses where it was cut, and
 * every word typed marked in it.
 */
export const passageOf = (text: string, words: ReadonlyArray<string>, around = 70): ReadonlyArray<Part> | null => {
  const hits = words.flatMap((word) => everyHit(text, word))
  if (hits.length === 0) return null
  const first = Math.min(...hits.map(([from]) => from))
  let from = Math.max(0, first - around)
  if (from > 0) from = text.indexOf(' ', from) + 1
  let to = Math.min(text.length, first + around * 2)
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to)
    if (space > first) to = space
  }
  const inside = merge(hits.filter(([a, b]) => a >= from && b <= to).map(([a, b]) => [a - from, b - from]))
  const parts = partsOf(text.slice(from, to), inside)
  return [...(from > 0 ? [{ text: '…', hit: false }] : []), ...parts, ...(to < text.length ? [{ text: '…', hit: false }] : [])]
}
