/*
 * The project's own words in what was said (ADR-017). The speech model writes
 * `RefundLedger` as "refund ledger" and `useEffect` as "use effect"; where the
 * project's code has a name whose parts are those words, in that order, it is
 * written as the code writes it. A file's name follows from it: "refund
 * ledger dot ts" becomes `RefundLedger.ts` where the project has that file.
 *
 * Only names of two words or more count, and none with a small word in them
 * ("is open", "get user", "to string"), so an ordinary sentence stays one.
 * Where two names are said alike, the one the project uses most wins.
 */

/** Small words: a name with one in it is too often just a sentence. */
const SMALL = new Set(
  'a an the is are was were be been has have had do does did to of in on at by for from with and or not no it its as if get set can should will would this that these those my your our all new old up down out off'.split(
    ' ',
  ),
)

/** What a file can end in, as said: "dot ts", or written ".ts". */
const ENDING = /^[a-z0-9]{1,6}$/i

/** The words a name is said as: its parts, in lower case. `RefundLedger` → refund ledger; `MAX_RETRIES` → max retries; `charges-api` → charges api. */
export const partsOf = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase())

export interface Vocabulary {
  /** Each name, by the words it is said as. */
  readonly names: ReadonlyMap<string, string>
  /** Each file's name, by its own name in lower case. */
  readonly files: ReadonlyMap<string, string>
  /** The most words a name is said in. */
  readonly longest: number
}

export const NO_VOCABULARY: Vocabulary = { names: new Map(), files: new Map(), longest: 0 }

/** The project's names, most used first, as something to respell with. */
export const vocabularyOf = (words: ReadonlyArray<string>): Vocabulary => {
  const names = new Map<string, string>()
  const files = new Map<string, string>()
  let longest = 0
  for (const word of words) {
    const dot = word.lastIndexOf('.')
    if (dot > 0 && ENDING.test(word.slice(dot + 1))) {
      if (!files.has(word.toLowerCase())) files.set(word.toLowerCase(), word)
      continue
    }
    const parts = partsOf(word)
    if (parts.length < 2 || parts.some((part) => SMALL.has(part))) continue
    const said = parts.join(' ')
    if (names.has(said)) continue
    names.set(said, word)
    longest = Math.max(longest, parts.length)
  }
  return { names, files, longest }
}

/* A word, with an apostrophe inside it as in "ledger's", and what comes between words. */
const WORD = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g

/** `text` with the project's names written as the project writes them. */
export const respell = (text: string, vocabulary: Vocabulary): string => {
  if (vocabulary.longest === 0 && vocabulary.files.size === 0) return text
  const words = [...text.matchAll(WORD)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }))
  let out = ''
  let from = 0
  for (let i = 0; i < words.length;) {
    let matched = 0
    let name = ''
    let tail = ''
    for (let n = Math.min(vocabulary.longest, words.length - i); n >= 2; n -= 1) {
      const span = words.slice(i, i + n)
      // Only words said together: a comma or a full stop between them parts them.
      if (span.some((word, k) => k > 0 && !/^\s+$/.test(text.slice((span[k - 1] as typeof word).end, word.start)))) continue
      const last = span[n - 1] as (typeof span)[number]
      const possessive = /'s$/i.exec(last.text)?.[0] ?? ''
      const said = span
        .map((word, k) => (k === n - 1 ? word.text.slice(0, word.text.length - possessive.length) : word.text).toLowerCase())
        .join(' ')
      const found = vocabulary.names.get(said)
      if (found !== undefined) {
        matched = n
        name = found
        tail = possessive
        break
      }
    }
    if (matched === 0) {
      i += 1
      continue
    }
    const first = words[i] as (typeof words)[number]
    const end = (words[i + matched - 1] as (typeof words)[number]).end
    out += text.slice(from, first.start) + name + tail
    from = end
    i += matched
  }
  out += text.slice(from)
  // A file the project has, said with its ending: "RefundLedger dot ts", or written "RefundLedger.TS".
  return out.replace(/([A-Za-z0-9_-]+)(?:\s+dot\s+|\.)([A-Za-z0-9]{1,6})\b/g, (whole: string, base: string, ending: string) => {
    return vocabulary.files.get(`${base}.${ending}`.toLowerCase()) ?? whole
  })
}
