import type { GrammarState, HighlighterCore, ThemedToken, ThemeRegistration } from 'shiki/core'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'

/*
 * A file's colours, by Shiki: the grammars editors use, read with its
 * JavaScript engine (no WebAssembly), each language loaded the first time
 * a file of it shows. The colours are the kit's syntax inks (tokens.css),
 * as CSS variables, so a theme of the kit's own draws them: what the
 * language says, what is written out, what is called, a type, a comment,
 * punctuation. Not the product's violet or cobalt, nor a change's green or
 * red, and each readable on the yellow of the lines an agent named.
 */

/** The languages a file's name says, by what follows its last dot, or its whole name. */
const BY_KIND: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  rs: 'rust',
  go: 'go',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  diff: 'diff',
  patch: 'diff',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  ini: 'ini',
  vue: 'vue',
  svelte: 'svelte',
}

const BY_NAME: Readonly<Record<string, string>> = { dockerfile: 'dockerfile', makefile: 'make', '.gitignore': 'ini', '.env': 'ini' }

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

/** The language a file is in, for its colours, by its name: null for one that isn't coloured. */
export const languageOf = (path: string): string | null => {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  const named = BY_NAME[name]
  if (named !== undefined) return named
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? null : (BY_KIND[name.slice(dot + 1)] ?? null)
}

/** Prose, which wraps at the width it is read in rather than scrolling sideways: markdown, plain text, a file without a kind but a dotfile. */
export const isProse = (path: string) => {
  const name = path.split('/').pop() ?? path
  return /\.(md|mdx|markdown|txt|text)$/i.test(name) || (!name.startsWith('.') && !/.\.[^.]+$/.test(name))
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

/** Past this, a file shows plain: colouring it would hold the window up for little. */
const MOST_COLOURED = { lines: 20_000, bytes: 1024 * 1024 }

/** A stretch of a line in one ink: its text, and its colour and weight where it has one. */
export interface Token {
  readonly content: string
  readonly style?: CSSProperties
}

/** A text's lines, each as its tokens. */
export type TokenLines = ReadonlyArray<ReadonlyArray<Token>>

/** What was coloured last, by its language and text: a peek and the panel show the same file, a diff its two sides. */
const coloured = new Map<string, TokenLines>()
const KEPT = 12

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

/**
 * How many lines are coloured at a time, and how long colouring holds the
 * window before it lets it draw and answer: a long file, or both sides of a
 * long diff, takes seconds to colour, and the window scrolls meanwhile.
 */
const SLICE = { lines: 25, ms: 12 }

const pause = () => new Promise<void>((done) => setTimeout(done, 0))

/** A text being coloured: those waiting for it, and whether they all stopped, so it stops too. */
interface Job {
  done: Promise<TokenLines>
  waiting: number
  dropped: boolean
}
const colouring = new Map<string, Job>()

/** A text's lines as tokens in their inks, by its language, a slice at a time, each slice taking up where the last one left the grammar. */
const tokenize = async (key: string, text: string, lang: string, job: Job): Promise<TokenLines> => {
  const shown = await highlighter()
  const grammar = GRAMMARS[lang]
  if (grammar === undefined) throw new Error(`No grammar for ${lang}`)
  if (!shown.getLoadedLanguages().includes(lang)) await shown.loadLanguage((await grammar()) as never)
  const rows = text.split('\n')
  const tokens: Token[][] = []
  let state: GrammarState | undefined
  let since = performance.now()
  for (let at = 0; at < rows.length; at += SLICE.lines) {
    if (job.dropped) throw new Error('No one is waiting for it')
    const slice = shown.codeToTokens(rows.slice(at, at + SLICE.lines).join('\n'), {
      lang,
      theme: 'althar',
      tokenizeMaxLineLength: 2000,
      ...(state === undefined ? {} : { grammarState: state }),
    })
    state = slice.grammarState
    for (const line of slice.tokens) tokens.push(line.map(tokenOf))
    if (performance.now() - since > SLICE.ms) {
      await pause()
      since = performance.now()
    }
  }
  coloured.set(key, tokens)
  if (coloured.size > KEPT) coloured.delete(coloured.keys().next().value ?? '')
  return tokens
}

/** A text's tokens, coloured once however many show it at a time; dropped by all of them, it stops. */
const colour = (text: string, lang: string): { readonly done: Promise<TokenLines>; readonly drop: () => void } => {
  const key = `${lang}\u0000${text}`
  const kept = coloured.get(key)
  if (kept !== undefined) return { done: Promise.resolve(kept), drop: () => undefined }
  let job = colouring.get(key)
  if (job === undefined) {
    const made: Job = { done: Promise.resolve([]), waiting: 0, dropped: false }
    made.done = tokenize(key, text, lang, made).finally(() => {
      if (colouring.get(key) === made) colouring.delete(key)
    })
    colouring.set(key, made)
    job = made
  }
  const mine = job
  mine.waiting += 1
  let gone = false
  return {
    done: mine.done,
    drop: () => {
      if (gone) return
      gone = true
      mine.waiting -= 1
      if (mine.waiting > 0) return
      mine.dropped = true
      if (colouring.get(key) === mine) colouring.delete(key)
    },
  }
}

/** Tokens as nodes: plain text where a token has no ink, a span in its ink where it has. */
export const inked = (tokens: ReadonlyArray<Token>, key = ''): ReactNode[] =>
  tokens.map((token, i) =>
    token.style === undefined ? (
      token.content
    ) : (
      <span key={`${key}${i}`} style={token.style}>
        {token.content}
      </span>
    ),
  )

/**
 * A file's lines as their tokens: null while they are coloured, and for a
 * language not coloured or a file too long to colour, which shows plain.
 */
export function useTokens(text: string | null, path: string): TokenLines | null {
  const lang = languageOf(path)
  const key = text === null || lang === null ? null : `${lang}\u0000${text}`
  const [shown, setShown] = useState<{ readonly key: string; readonly lines: TokenLines } | null>(() =>
    key === null ? null : { key, lines: coloured.get(key) ?? [] },
  )
  useEffect(() => {
    if (text === null || lang === null || key === null) return
    if (text.length > MOST_COLOURED.bytes || text.split('\n', MOST_COLOURED.lines + 1).length > MOST_COLOURED.lines) return
    let on = true
    const job = colour(text, lang)
    job.done.then(
      (lines) => {
        if (on) setShown({ key, lines })
      },
      // A grammar that wouldn't load leaves it plain.
      () => undefined,
    )
    return () => {
      on = false
      job.drop()
    }
  }, [key, text, lang])
  return shown !== null && shown.key === key && shown.lines.length > 0 ? shown.lines : null
}

/**
 * A file's lines in their colours: null while they are coloured, and for a
 * language not coloured or a file too long to colour, which shows plain.
 */
export function useColoured(text: string | null, path: string): ReadonlyArray<ReactNode> | null {
  const tokens = useTokens(text, path)
  return useMemo(() => (tokens === null ? null : tokens.map((line) => inked(line))), [tokens])
}
