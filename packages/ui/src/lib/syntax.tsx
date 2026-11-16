import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'

import { type ColourAnswer, type ColourAsk, slices, type Token, type TokenLines, unpack } from './shiki'

export type { Token, TokenLines } from './shiki'

/*
 * A file's colours, as the window shows them. They are worked out off the
 * window's thread, in a worker (shiki.ts says how), each text once however
 * many places show it, and the last few are kept: a peek and the panel show
 * the same file, a diff its two sides. A file's lines show plain until their
 * colours come, and take them as they come, its first lines first.
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

/** Past this, a file shows plain: colouring it would hold the window up for little. */
const MOST_COLOURED = { lines: 20_000, bytes: 1024 * 1024 }

const keyOf = (lang: string, text: string) => `${lang}\u0000${text}`

/** What was coloured last, by its language and text. */
const coloured = new Map<string, TokenLines>()
const KEPT = 12

const keep = (key: string, lines: TokenLines) => {
  coloured.set(key, lines)
  if (coloured.size > KEPT) coloured.delete(coloured.keys().next().value ?? '')
}

/** What a text being coloured hears: its lines as they come, and whether those are the last; or that it can't be. */
interface Hears {
  readonly lines: (lines: TokenLines, done: boolean) => void
  readonly failed: () => void
}

/** How long colouring in place holds the window before it lets it draw and answer. */
const HOLD = 12

const pause = () => new Promise<void>((done) => setTimeout(done, 0))

/**
 * A text's lines coloured in place, where there is no worker: a slice at a time, the window drawing and answering between
 * them, all of them at once when done; null once stopped.
 */
const colourInPlace = async (text: string, lang: string, stopped: () => boolean): Promise<TokenLines | null> => {
  const next = await slices(text, lang)
  const tokens: Token[][] = []
  let since = performance.now()
  for (let lines = next(); lines !== null; lines = next()) {
    if (stopped()) return null
    tokens.push(...lines)
    if (performance.now() - since > HOLD) {
      await pause()
      since = performance.now()
    }
  }
  return tokens
}

/** The worker, made the first time a text is coloured: null where there can be none, or it failed, and texts colour in place. */
let worker: Worker | null | undefined
/** Each text asked of the worker, by its id: what hears it, and how to colour it in place instead should the worker fail. */
const asked = new Map<number, { readonly hears: Hears; readonly inPlace: () => void }>()
/** The inks the worker has named, in the order it named them; the first is none. */
const inks: Array<CSSProperties | undefined> = [undefined]
let lastId = 0

const theWorker = (): Worker | null => {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined') return (worker = null)
  try {
    const made = new Worker(new URL('./syntax.worker.ts', import.meta.url), { type: 'module' })
    made.onmessage = (event: MessageEvent<ColourAnswer>) => {
      const answer = event.data
      const one = asked.get(answer.id)
      if ('failed' in answer) {
        asked.delete(answer.id)
        one?.hears.failed()
        return
      }
      inks.push(...answer.inks)
      if (answer.done) asked.delete(answer.id)
      one?.hears.lines(unpack(answer.lines, inks), answer.done)
    }
    // A worker that won't start, or breaks, leaves what it was colouring to colour in place, and all after it.
    made.onerror = () => {
      made.terminate()
      worker = null
      const left = [...asked.values()]
      asked.clear()
      for (const one of left) one.inPlace()
    }
    worker = made
  } catch {
    worker = null
  }
  return worker
}

/** Starts colouring a text, in the worker or else in place; returns the way to stop. */
const start = (text: string, lang: string, hears: Hears): (() => void) => {
  let stopped = false
  const inPlace = () => {
    colourInPlace(text, lang, () => stopped).then((lines) => {
      if (lines !== null) hears.lines(lines, true)
    }, hears.failed)
  }
  const to = theWorker()
  if (to === null) {
    inPlace()
    return () => {
      stopped = true
    }
  }
  const id = (lastId += 1)
  asked.set(id, { hears, inPlace })
  to.postMessage({ type: 'colour', id, text, lang } satisfies ColourAsk)
  return () => {
    stopped = true
    if (asked.delete(id)) worker?.postMessage({ type: 'drop', id } satisfies ColourAsk)
  }
}

/** What shows a text hears: its lines coloured so far. */
type Show = (lines: TokenLines) => void

/** A text being coloured: its lines so far, those showing it, and how to stop. */
interface Job {
  lines: TokenLines
  readonly shows: Set<Show>
  stop: () => void
}
const colouring = new Map<string, Job>()

/**
 * Colours a text once however many show it at a time, telling each its lines as they come; dropped by all of them, it
 * stops. Returns the way to drop it.
 */
const colour = (text: string, lang: string, show: Show): (() => void) => {
  const key = keyOf(lang, text)
  const kept = coloured.get(key)
  if (kept !== undefined) {
    show(kept)
    return () => undefined
  }
  let job = colouring.get(key)
  if (job === undefined) {
    const made: Job = { lines: [], shows: new Set(), stop: () => undefined }
    const over = () => {
      if (colouring.get(key) === made) colouring.delete(key)
    }
    made.stop = start(text, lang, {
      lines: (more, done) => {
        if (more.length > 0) made.lines = made.lines.length === 0 ? more : made.lines.concat(more)
        if (done) {
          keep(key, made.lines)
          over()
        }
        for (const one of made.shows) one(made.lines)
      },
      // A grammar that wouldn't load leaves it plain.
      failed: over,
    })
    colouring.set(key, made)
    job = made
  }
  const mine = job
  mine.shows.add(show)
  if (mine.lines.length > 0) show(mine.lines)
  return () => {
    mine.shows.delete(show)
    if (mine.shows.size > 0) return
    mine.stop()
    if (colouring.get(key) === mine) colouring.delete(key)
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
 * A file's lines as their tokens, those coloured so far: null while none
 * are, and for a language not coloured or a file too long to colour, which
 * shows plain.
 */
export function useTokens(text: string | null, path: string): TokenLines | null {
  const lang = languageOf(path)
  const key = text === null || lang === null ? null : keyOf(lang, text)
  const [shown, setShown] = useState<{ readonly key: string; readonly lines: TokenLines } | null>(() =>
    key === null ? null : { key, lines: coloured.get(key) ?? colouring.get(key)?.lines ?? [] },
  )
  useEffect(() => {
    if (text === null || lang === null || key === null) return
    if (text.length > MOST_COLOURED.bytes || text.split('\n', MOST_COLOURED.lines + 1).length > MOST_COLOURED.lines) return
    return colour(text, lang, (lines) => setShown((was) => (was !== null && was.key === key && was.lines === lines ? was : { key, lines })))
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
