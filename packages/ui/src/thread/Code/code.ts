/*
 * The code an agent names in what it says, as the host found it where the
 * thread's agent works: what a name names, how a file was read, and the
 * small words every view of it shares. The host reads and opens; the kit
 * draws.
 */

/** What a name in a message names: a file and the lines it named, a path that isn't there, or a file's name several files have. */
export type FoundCode =
  | {
      readonly kind: 'file'
      /** The name, as the agent wrote it. */
      readonly name: string
      readonly path: string
      readonly line?: number
      readonly end?: number
      /** The name in code it named, where it named one rather than the file. */
      readonly symbol?: string
      /** Found by its file's name alone. */
      readonly byName: boolean
      readonly bytes: number
      readonly lines: number
      readonly content: 'text' | 'binary' | 'large'
      /** What its task changed in it. */
      readonly changed: { readonly add: number; readonly del: number } | null
      /** How it was when the message was said, where it changed since: where the lines named are now, null where rewritten. */
      readonly since: { readonly commit: string; readonly now?: { readonly line: number; readonly end?: number } | null } | null
    }
  | { readonly kind: 'missing'; readonly name: string; readonly path: string; readonly near: readonly string[] }
  | { readonly kind: 'several'; readonly name: string; readonly line?: number; readonly end?: number; readonly paths: readonly string[] }

export type FoundFile = Extract<FoundCode, { kind: 'file' }>

/** A file's text as the host read it: whole, or past a size the lines around those named. */
export interface CodeRead {
  readonly text: string
  /** Its first line's number. */
  readonly from: number
  /** How many lines the file has. */
  readonly total: number
  readonly cut: boolean
}

/** Where it was read from: the task's folder on its branch, or the default branch; and when the message was said, in words. */
export interface CodeWhere {
  readonly kind: 'task' | 'default'
  readonly branch: string
  /** How long ago the message was said: "2 h ago". */
  readonly said?: string
}

/** How a file is shown: as it is, as it was when the message was said, or what its task changed in it. */
export type CodeMode = 'now' | 'then' | 'change'

export const nameOf = (path: string) => path.replace(/\/$/, '').split('/').pop() ?? path

export const folderOf = (path: string) => {
  const clean = path.replace(/\/$/, '')
  return clean.slice(0, clean.length - nameOf(clean).length)
}

/** The lines a name gives, as an agent would write them: `:12`, `:12–30`. */
export const linesOf = (line?: number, end?: number) =>
  line === undefined ? '' : end === undefined || end === line ? `:${line}` : `:${line}–${end}`

/** How big a file is, in words. */
export const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`

/** How it opens first: as it was when said, where the lines it named were rewritten since; else as it is. */
export const firstMode = (found: FoundCode): CodeMode => (found.kind === 'file' && found.since?.now === null ? 'then' : 'now')

/** The lines to mark in what is shown: those named, followed to where they are now; none past the file's end, nor rewritten. */
export const markOf = (found: FoundFile, mode: CodeMode): { readonly line: number; readonly end: number } | null => {
  if (found.line === undefined || (found.since === null && found.line > found.lines)) return null
  if (mode === 'then' || found.since === null || found.since.now === undefined) return { line: found.line, end: found.end ?? found.line }
  if (found.since.now === null) return null
  return { line: found.since.now.line, end: found.since.now.end ?? found.since.now.line }
}

/** The line to open the file at in an editor: where the lines named are now. */
export const lineToOpen = (found: FoundFile): number | undefined => {
  if (found.since?.now != null) return found.since.now.line
  return found.line !== undefined && found.line <= found.lines ? found.line : undefined
}

/** What Copy path copies: the path, and the line it opens at. */
export const copyOf = (found: FoundCode) => {
  if (found.kind === 'several') return found.name
  const line = found.kind === 'file' ? lineToOpen(found) : undefined
  return `${found.path}${line === undefined ? '' : `:${line}`}`
}

const NOT_NAMES = new Set(
  'true false null undefined void never string number boolean object const let var function return import export async await this new type interface enum class'.split(
    ' ',
  ),
)

/**
 * Whether what an agent put in backticks may name code, to ask the host:
 * a path, a file's name, a path and its lines, or a name in code as one
 * reads (camelCase, PascalCase of more than a word, snake_case, called()).
 * Never a command, a value, or a word.
 */
export const mayBeCode = (raw: string): boolean => {
  const text = raw.trim().replace(/(:\d+([-–:]\d+)?|#L\d+(-L?\d+)?)$/, '')
  if (text.length < 2 || text.length > 300 || /\s/.test(raw.trim()) || /^[-$#@'"{[<(]/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text))
    return false
  if (text.includes('/') || /(^|[^.])\.[A-Za-z0-9]{1,10}$/.test(text)) return !/^\d+(\.\d+)+$/.test(text)
  const bare = text.replace(/\(\)$/, '')
  if (!/^[A-Za-z_$][\w$]*$/.test(bare) || bare.length < 4 || NOT_NAMES.has(bare)) return false
  return text.endsWith('()') || /[a-z][A-Z]/.test(bare) || /[A-Za-z0-9]_[A-Za-z]/.test(bare)
}

/**
 * A path written into the words without backticks: with a folder and a
 * kind after the dot, or a file's name of a kind code is often in (not
 * `.js`, which names Node.js as often as a file), with its lines, if any.
 */
export const PLAIN_PATH =
  /(?<![\w/.@~-])((?:[\w@.-]+\/)+[\w@.-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,6}|[\w-]+\.(?:tsx?|mts|cts|jsx|mjs|cjs|json|md|mdx|css|scss|sql|ya?ml|toml|py|rs|go|swift|kt|sh))(?::\d+(?:[-–]\d+)?)?(?![\w/])/g
