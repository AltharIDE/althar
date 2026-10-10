import type { CommandOutput, FileMention, Picture } from '@althar/contracts'
import { type ImageRef, ToolState } from '@althar/ui'

import { pictureUrl } from '../../main/pictureAddress'

/*
 * What a turn hands back, as the thread shows it beside its words (docs/
 * plans and the kit's "It hands back"): the pictures it made, as one set of
 * screenshots; the markdown documents it wrote or pointed at, each a card
 * that opens in the side panel; and other files it pointed at, each a card.
 * A command's output stays in its tool call. Files it changed in passing are
 * the task's change, not something it handed back, so they make no card.
 */

/** A command's output as far as it has come, while it runs: its last lines, and how many came before them. */
export interface OutputSoFar {
  readonly text: string
  readonly dropped: number
}

/** What a command shows in its tool call: its output so far while it runs, or how much it printed once it ended. */
export type Ran =
  /** `heard` once the window has heard its output stream; before then, what it printed so far is read. */
  | { readonly kind: 'running'; readonly text: string; readonly dropped: number; readonly heard: boolean }
  | { readonly kind: 'ended'; readonly output: CommandOutput }

/** A command's state for its tool call: null for a call that isn't a command, or one from before Althar kept output. */
export const ranOf = (
  content: { readonly toolKind: string; readonly output: CommandOutput | null },
  state: ToolState,
  soFar: OutputSoFar | undefined,
): Ran | null => {
  if (content.output !== null) return { kind: 'ended', output: content.output }
  if (state !== ToolState.Running || (content.toolKind !== 'execute' && soFar === undefined)) return null
  return { kind: 'running', text: soFar?.text ?? '', dropped: soFar?.dropped ?? 0, heard: soFar !== undefined }
}

/** A screenshot, as Shots and the lightbox draw it. */
export type Shot = ImageRef & { readonly id: string }

/** A file a turn handed back: by the path it named, and that path as the person reads it. */
export interface HandedFile {
  readonly id: string
  readonly path: string
  readonly shown: string
  /** Its whole path: which file it is, what it is read by, and what follows its edits. */
  readonly whole: string
  /** Its whole path, where it is in the task's folder, for the editor to open; null elsewhere. */
  readonly local: string | null
  /** What kind of file, from its name: Markdown, CSV. */
  readonly kind: string
  /** Its size, in words, where the agent said. */
  readonly size: string | null
}

export interface Handed {
  readonly pictures: ReadonlyArray<Shot>
  /** Markdown documents: each reads in the side panel. */
  readonly documents: ReadonlyArray<HandedFile>
  /** Any other file it pointed at. */
  readonly files: ReadonlyArray<HandedFile>
}

export const NOTHING_HANDED: Handed = { pictures: [], documents: [], files: [] }

export const text = {
  picture: (n: number) => `Image ${n}`,
  size: (width: number, height: number) => `${width} × ${height}`,
  unkept: {
    too_large: 'Not kept: larger than 20 MB',
    unsupported: 'Not kept: a kind of image Althar doesn’t show',
    unkept: 'Not kept',
  } satisfies Record<NonNullable<Picture['unkept']>, string>,
  kinds: { md: 'Markdown', markdown: 'Markdown', mdx: 'MDX', csv: 'CSV', json: 'JSON', txt: 'Text', pdf: 'PDF', html: 'HTML' } as Readonly<
    Record<string, string>
  >,
  file: 'File',
}

/** A size in bytes, as people read it. */
export const bytesText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MARKDOWN = /\.(md|markdown|mdx)$/i

export const isMarkdown = (path: string) => MARKDOWN.test(path)

const nameOf = (path: string) => path.split('/').findLast((part) => part !== '') ?? path

/** A file's kind, from the end of its name. */
export const kindOf = (path: string) => {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return extension === undefined ? text.file : (text.kinds[extension] ?? extension.toUpperCase())
}

/** A path inside the worktree, from the worktree; a `file://` address as its path; any other, whole. */
export const shownPath = (path: string, worktree: string | null) => {
  const local = path.startsWith('file://') ? decodeURIComponent(path.slice('file://'.length)) : path
  return worktree !== null && local.startsWith(`${worktree}/`) ? local.slice(worktree.length + 1) : local
}

/**
 * A file's whole path, which is which file it is: a `file://` address as its
 * path, and one named from the task's worktree put back under it.
 */
export const wholePath = (path: string, worktree: string | null): string => {
  const local = path.startsWith('file://') ? decodeURIComponent(path.slice('file://'.length)) : path
  return local.startsWith('/') || worktree === null ? local : `${worktree}/${local}`
}

/**
 * A file's whole path, as the editor opens it: one named from the task's
 * worktree is put back under it. Only one inside the task's folder, where
 * all its worktrees are (ADR-006), opens; null for anywhere else.
 */
export const editorPath = (path: string, worktree: string | null): string | null => {
  if (worktree === null) return null
  const whole = wholePath(path, worktree)
  const folder = worktree.slice(0, worktree.lastIndexOf('/'))
  return folder !== '' && whole.startsWith(`${folder}/`) ? whole : null
}

/** What one part of a turn handed back: its pictures and files, and, for a tool call, whether it finished. */
export interface PartHanded {
  readonly id: string
  readonly pictures: ReadonlyArray<Picture>
  readonly files: ReadonlyArray<FileMention>
  /** A tool call that didn't do what it set out to (declined, failed, stopped): what it would have written isn't there. */
  readonly undone?: boolean
  /** What names a picture that doesn't name itself: a tool call's target. */
  readonly target?: string
}

const PICTURE_NAME = /\.(png|jpe?g|gif|webp)$/i

/**
 * Everything a turn handed back, in order, each once: pictures by their
 * digest, files by their path. A file a call wrote counts only once the
 * call finished.
 */
export const handedBy = (parts: ReadonlyArray<PartHanded>, worktree: string | null): Handed => {
  const pictures: Array<Shot> = []
  const documents: Array<HandedFile> = []
  const files: Array<HandedFile> = []
  const seen = new Set<string>()
  for (const part of parts) {
    for (const [index, picture] of part.pictures.entries()) {
      const key = picture.digest ?? `${part.id}:${index}`
      if (seen.has(key)) continue
      seen.add(key)
      const named = picture.name ?? (part.target !== undefined && PICTURE_NAME.test(part.target) ? nameOf(part.target) : null)
      const name = named ?? text.picture(pictures.length + 1)
      const facts = [
        ...(picture.width === null || picture.height === null ? [] : [text.size(picture.width, picture.height)]),
        bytesText(picture.bytes),
      ]
      pictures.push({
        id: key,
        name,
        ...(picture.digest === null
          ? { status: 'failed' as const, meta: text.unkept[picture.unkept ?? 'unkept'] }
          : { src: pictureUrl(picture.digest), thumb: pictureUrl(picture.digest, true), meta: facts.join(' · ') }),
        ...(picture.width === null ? {} : { width: picture.width }),
        ...(picture.height === null ? {} : { height: picture.height }),
      })
    }
    for (const file of part.files) {
      if (file.how === 'wrote' && part.undone === true) continue
      const shown = shownPath(file.path, worktree)
      if (seen.has(`file:${shown}`)) continue
      const markdown = isMarkdown(shown)
      // A file written in passing is the task's change; only a document it wrote, or a file it pointed at, is handed back.
      if (!markdown && file.how === 'wrote') continue
      seen.add(`file:${shown}`)
      const handed = {
        id: `${part.id}:${shown}`,
        path: file.path,
        shown,
        whole: wholePath(file.path, worktree),
        local: editorPath(file.path, worktree),
        kind: kindOf(shown),
        size: file.bytes === null ? null : bytesText(file.bytes),
      }
      if (markdown) documents.push(handed)
      else files.push(handed)
    }
  }
  return pictures.length === 0 && documents.length === 0 && files.length === 0 ? NOTHING_HANDED : { pictures, documents, files }
}

/** A command's output as the kit's Terminal takes it: its last lines shown, those before them a click away. */
export const LINES_SHOWN = 12

export const linesOf = (output: string): { readonly lines: ReadonlyArray<string>; readonly earlier: ReadonlyArray<string> } => {
  const all = output.split('\n')
  if (all.at(-1) === '') all.pop()
  return { lines: all.slice(-LINES_SHOWN), earlier: all.slice(0, Math.max(all.length - LINES_SHOWN, 0)) }
}

/**
 * Where each file a thread names was last touched, by its whole path: by the tool call that last
 * named it, and how that call stood. A document read from where it is now is
 * read again when this changes, so a card and the panel follow its edits.
 */
export const lastTouches = (
  parts: ReadonlyArray<{ readonly kind: string; readonly id: string; readonly state?: string; readonly touches?: ReadonlyArray<string> }>,
  worktree: string | null,
): ReadonlyMap<string, string> => {
  const touched = new Map<string, string>()
  for (const part of parts) for (const path of part.touches ?? []) touched.set(wholePath(path, worktree), `${part.id}:${part.state ?? ''}`)
  return touched
}

/** Commands' output so far that the store now has whole: a call that ended no longer streams. */
export const outputsCaughtUp = (
  outputs: ReadonlyMap<string, OutputSoFar>,
  items: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly content: object }>,
): ReadonlyMap<string, OutputSoFar> => {
  const kept = new Map(outputs)
  for (const item of items) if (item.kind === 'tool_call' && 'output' in item.content && item.content.output !== null) kept.delete(item.id)
  return kept.size === outputs.size ? outputs : kept
}

/** A command's output so far, as a watch event says it, kept by its item. */
export const withOutput = (
  outputs: ReadonlyMap<string, OutputSoFar>,
  event: { readonly itemId: string; readonly text: string; readonly dropped: number },
) => new Map(outputs).set(event.itemId, { text: event.text, dropped: event.dropped })
