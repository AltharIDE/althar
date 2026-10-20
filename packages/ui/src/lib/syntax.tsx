import type { HighlighterCore, ThemeRegistration } from 'shiki/core'
import { type ReactNode, useEffect, useState } from 'react'

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

const ink = (name: string) => `var(--syn-${name})`

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

/** What was coloured last, by its language and text: a peek and the panel show the same file. */
const coloured = new Map<string, ReadonlyArray<ReactNode>>()
const KEPT = 12

const FONT_ITALIC = 1
const FONT_BOLD = 2

/** A text's lines as spans in their inks, by its language: one array of nodes per line. */
const colour = async (text: string, lang: string): Promise<ReadonlyArray<ReactNode>> => {
  const key = `${lang}\u0000${text}`
  const kept = coloured.get(key)
  if (kept !== undefined) return kept
  const shown = await highlighter()
  const grammar = GRAMMARS[lang]
  if (grammar === undefined) throw new Error(`No grammar for ${lang}`)
  if (!shown.getLoadedLanguages().includes(lang)) await shown.loadLanguage((await grammar()) as never)
  const lines = shown.codeToTokensBase(text, { lang, theme: 'althar', tokenizeMaxLineLength: 2000 })
  const nodes = lines.map((tokens) =>
    tokens.map((token, i) => {
      const style = {
        ...(token.color === undefined || token.color === 'var(--t-1)' ? {} : { color: token.color }),
        ...((token.fontStyle ?? 0) & FONT_ITALIC ? { fontStyle: 'italic' } : {}),
        ...((token.fontStyle ?? 0) & FONT_BOLD ? { fontWeight: 650 } : {}),
      }
      return Object.keys(style).length === 0 ? (
        token.content
      ) : (
        <span key={i} style={style}>
          {token.content}
        </span>
      )
    }),
  )
  coloured.set(key, nodes)
  if (coloured.size > KEPT) coloured.delete(coloured.keys().next().value ?? '')
  return nodes
}

/**
 * A file's lines in their colours: null while they are coloured, and for a
 * language not coloured or a file too long to colour, which shows plain.
 */
export function useColoured(text: string | null, path: string): ReadonlyArray<ReactNode> | null {
  const lang = languageOf(path)
  const key = text === null || lang === null ? null : `${lang}\u0000${text}`
  const [shown, setShown] = useState<{ readonly key: string; readonly lines: ReadonlyArray<ReactNode> } | null>(() =>
    key === null ? null : { key, lines: coloured.get(key) ?? [] },
  )
  useEffect(() => {
    if (text === null || lang === null || key === null) return
    if (text.length > MOST_COLOURED.bytes || text.split('\n', MOST_COLOURED.lines + 1).length > MOST_COLOURED.lines) return
    let on = true
    colour(text, lang).then(
      (lines) => {
        if (on) setShown({ key, lines })
      },
      // A grammar that wouldn't load leaves it plain.
      () => undefined,
    )
    return () => {
      on = false
    }
  }, [key, text, lang])
  return shown !== null && shown.key === key && shown.lines.length > 0 ? shown.lines : null
}
