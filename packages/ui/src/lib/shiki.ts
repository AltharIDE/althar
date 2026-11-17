import type { CSSProperties } from 'react'
import type { GrammarState, HighlighterCore, ThemedToken, ThemeRegistration } from 'shiki/core'

/*
 * A file's colours, by Shiki: the grammars editors use, read with its
 * JavaScript engine (no WebAssembly), each language loaded the first time
 * a file of it shows. The colours are the kit's syntax inks (tokens.css),
 * as CSS variables, so a theme of the kit's own draws them: what the
 * language says, what is written out, what is called, a type, a comment,
 * punctuation. Not the product's violet or cobalt, nor a change's green or
 * red, and each readable on the yellow of the lines an agent named.
 *
 * Colouring a long file takes seconds, so it runs in a worker of its own
 * (syntax.worker.ts), which hands the window the lines as it colours them;
 * where there is no worker, it runs in place, a slice at a time
 * (syntax.tsx). This is what both share.
 */

/** Each language's grammar, fetched the first time a file of it shows. */
const GRAMMARS: Readonly<Record<string, () => Promise<unknown>>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  make: () => import('shiki/langs/make.mjs'),
}

/** An ink, which a place drawing code on a colour of its own may tint by setting `--code-<name>`: a diff's green and red. */
const ink = (name: string) => `var(--code-${name}, var(--syn-${name}))`

/** The kit's own theme: TextMate's scopes, each kind in its ink. */
const THEME: ThemeRegistration = {
  name: 'althar',
  type: 'light',
  colors: { 'editor.foreground': 'var(--t-1)', 'editor.background': 'transparent' },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: ink('comment'), fontStyle: 'italic' } },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator', 'storage.type.function.arrow', 'meta.tag.sgml'],
      settings: { foreground: ink('punct') },
    },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.operator.new',
        'keyword.operator.expression',
        'keyword.operator.logical.python',
        'keyword.operator.word',
        'variable.language',
        'entity.name.tag',
        'markup.list punctuation.definition',
        'punctuation.definition.heading',
        'punctuation.definition.list',
        'punctuation.definition.quote',
      ],
      settings: { foreground: ink('keyword') },
    },
    {
      scope: [
        'string',
        'constant.numeric',
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
        'markup.inline.raw',
        'markup.fenced_code',
      ],
      settings: { foreground: ink('string') },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'variable.function',
        'entity.other.attribute-name',
        'meta.object-literal.key',
        'support.type.property-name',
        'meta.property-name',
        'markup.underline.link',
        'string.other.link',
      ],
      settings: { foreground: ink('fn') },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
        'entity.name.namespace',
        'entity.other.attribute-name.class.css',
        'support.type.builtin',
        'storage.type.primitive',
      ],
      settings: { foreground: ink('type') },
    },
    { scope: ['markup.heading', 'entity.name.section'], settings: { foreground: 'var(--t-1)', fontStyle: 'bold' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.deleted'], settings: { foreground: 'var(--del-ink-2)' } },
    { scope: ['markup.inserted'], settings: { foreground: 'var(--add-ink-2)' } },
  ],
}

let shiki: Promise<HighlighterCore> | null = null

/** The highlighter, made the first time a file is coloured, with no language until one is asked for. */
const highlighter = () => {
  shiki ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([core, engine]) =>
    core.createHighlighterCore({ themes: [THEME], langs: [], engine: engine.createJavaScriptRegexEngine({ forgiving: true }) }),
  )
  return shiki
}

/** A stretch of a line in one ink: its text, and its colour and weight where it has one. */
export interface Token {
  readonly content: string
  readonly style?: CSSProperties
}

/** A text's lines, each as its tokens. */
export type TokenLines = ReadonlyArray<ReadonlyArray<Token>>

const FONT_ITALIC = 1
const FONT_BOLD = 2

const tokenOf = (token: ThemedToken): Token => {
  const style = {
    ...(token.color === undefined || token.color === 'var(--t-1)' ? {} : { color: token.color }),
    ...((token.fontStyle ?? 0) & FONT_ITALIC ? { fontStyle: 'italic' } : {}),
    ...((token.fontStyle ?? 0) & FONT_BOLD ? { fontWeight: 650 } : {}),
  }
  return Object.keys(style).length === 0 ? { content: token.content } : { content: token.content, style }
}

const sameInk = (a: Token, b: Token) =>
  a.style?.color === b.style?.color && a.style?.fontStyle === b.style?.fontStyle && a.style?.fontWeight === b.style?.fontWeight

/** A line's tokens with each run of the same ink as one: fewer spans for a long file or diff to draw. */
const merged = (line: readonly Token[]): Token[] => {
  const out: Token[] = []
  for (const token of line) {
    const last = out.at(-1)
    if (last !== undefined && sameInk(last, token)) out[out.length - 1] = { ...last, content: last.content + token.content }
    else out.push(token)
  }
  return out
}

/** How many lines are coloured at a time. */
export const SLICE = 25

/**
 * A text's colouring, a slice at a time: each call colours the next slice of its lines, taking up where the last one left
 * the grammar, and gives them; null once all are. Fails where its language has no grammar, or the grammar won't load.
 */
export const slices = async (text: string, lang: string): Promise<() => Token[][] | null> => {
  const shown = await highlighter()
  // Only a grammar of the table's own: a language comes in a message, and a name such as `constructor` is not one.
  const grammar = Object.hasOwn(GRAMMARS, lang) ? GRAMMARS[lang] : undefined
  if (grammar === undefined) throw new Error(`No grammar for ${lang}`)
  if (!shown.getLoadedLanguages().includes(lang)) await shown.loadLanguage((await grammar()) as never)
  const rows = text.split('\n')
  let at = 0
  let state: GrammarState | undefined
  return () => {
    if (at >= rows.length) return null
    const slice = shown.codeToTokens(rows.slice(at, at + SLICE).join('\n'), {
      lang,
      theme: 'althar',
      tokenizeMaxLineLength: 2000,
      ...(state === undefined ? {} : { grammarState: state }),
    })
    state = slice.grammarState
    at += SLICE
    return slice.tokens.map((line) => merged(line.map(tokenOf)))
  }
}

/*
 * Between the window and the worker. The window asks for a text by an id of
 * its own, and drops it once nothing shows it. The worker answers with the
 * lines it has coloured since it last did, packed flat so they cross in a
 * few arrays rather than an object for every stretch: each stretch's words,
 * the place of its ink among the inks (0 for none), and where each line's
 * stretches end. It names each ink once, the first time it uses one, and
 * the window keeps them in that order.
 */

export type ColourAsk =
  | { readonly type: 'colour'; readonly id: number; readonly text: string; readonly lang: string }
  | { readonly type: 'drop'; readonly id: number }

/** Lines, packed: each stretch's words and the place of its ink, and where each line's stretches end. */
export interface Packed {
  readonly words: readonly string[]
  readonly inks: Uint16Array
  readonly ends: Uint32Array
}

export type ColourAnswer =
  | {
      readonly id: number
      readonly lines: Packed
      /** Inks used here for the first time, to add to those already named. */
      readonly inks: readonly CSSProperties[]
      /** Whether these are the last of its lines. */
      readonly done: boolean
    }
  /** Its language has no grammar, or the grammar wouldn't load: it shows plain. */
  | { readonly id: number; readonly failed: true }

/** Packed lines as tokens, by the inks named so far (the first, none). */
export const unpack = (lines: Packed, inks: ReadonlyArray<CSSProperties | undefined>): Token[][] => {
  const out: Token[][] = []
  let from = 0
  for (const end of lines.ends) {
    const line: Token[] = []
    for (let at = from; at < end; at += 1) {
      const content = lines.words[at] ?? ''
      const style = inks[lines.inks[at] ?? 0]
      line.push(style === undefined ? { content } : { content, style })
    }
    out.push(line)
    from = end
  }
  return out
}

/**
 * How long the worker colours one text before another has its turn, and before it hears whether any was dropped; and how
 * often, after its first turn, a text tells the window the lines coloured since it last did. In ms.
 */
const PACE = { turn: 16, told: 120 }

/** A text the worker colours: its next slice, once its grammar is read; and its lines coloured since it last told the window. */
interface Colouring {
  next: (() => Token[][] | null) | null
  words: string[]
  inks: number[]
  ends: number[]
  /** When it last told the window, null before its first turn. */
  told: number | null
}

/**
 * The worker's side: colours each text asked for a turn at a time, in turn with the others, and tells the window its lines
 * as it goes: after its first turn, so what shows first is coloured at once, then every so often, then once it is done.
 * `later` runs what's next once the worker has heard what was sent meanwhile. Returns what hears the window.
 */
export const serveColours = (
  answer: (message: ColourAnswer, transfer: Transferable[]) => void,
  later: (next: () => void) => void,
  pace: { readonly turn: number; readonly told: number } = PACE,
): ((ask: ColourAsk) => void) => {
  const jobs = new Map<number, Colouring>()
  const inkIds = new Map<string, number>()
  let fresh: CSSProperties[] = []
  let running = false

  const inkOf = (style: CSSProperties | undefined) => {
    if (style === undefined) return 0
    const key = `${String(style.color)}|${String(style.fontStyle)}|${String(style.fontWeight)}`
    const known = inkIds.get(key)
    if (known !== undefined) return known
    fresh.push(style)
    inkIds.set(key, inkIds.size + 1)
    return inkIds.size
  }

  const tell = (id: number, job: Colouring, done: boolean) => {
    const inks = Uint16Array.from(job.inks)
    const ends = Uint32Array.from(job.ends)
    answer({ id, lines: { words: job.words, inks, ends }, inks: fresh, done }, [inks.buffer, ends.buffer])
    fresh = []
    job.words = []
    job.inks = []
    job.ends = []
    job.told = performance.now()
  }

  const turn = () => {
    for (const [id, job] of jobs) {
      const next = job.next
      if (next === null || jobs.get(id) !== job) continue
      const since = performance.now()
      let done = false
      do {
        const lines = next()
        if (lines === null) done = true
        else
          for (const line of lines) {
            for (const token of line) {
              job.words.push(token.content)
              job.inks.push(inkOf(token.style))
            }
            job.ends.push(job.words.length)
          }
      } while (!done && performance.now() - since < pace.turn)
      if (done) jobs.delete(id)
      if (done || job.told === null || performance.now() - job.told >= pace.told) tell(id, job, done)
    }
    running = [...jobs.values()].some((job) => job.next !== null)
    if (running) later(turn)
  }

  const run = () => {
    if (running) return
    running = true
    later(turn)
  }

  return (ask) => {
    if (ask.type === 'drop') {
      jobs.delete(ask.id)
      return
    }
    const job: Colouring = { next: null, words: [], inks: [], ends: [], told: null }
    jobs.set(ask.id, job)
    slices(ask.text, ask.lang).then(
      (next) => {
        if (jobs.get(ask.id) !== job) return
        job.next = next
        run()
      },
      () => {
        if (jobs.get(ask.id) !== job) return
        jobs.delete(ask.id)
        answer({ id: ask.id, failed: true }, [])
      },
    )
  }
}
