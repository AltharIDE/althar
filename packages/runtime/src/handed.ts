import { realpath, readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CommandOutput, FileMention as ContractFile, Picture } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Handed, ToolContent } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { Artifacts } from './Artifacts'
import { pictureSize, pictureType } from './pictures'

/*
 * What an agent hands back beside its words, as a thread item keeps it
 * (docs/architecture/07): a picture's bytes go to the artifact store and the
 * item keeps what it is and its digest; a file it wrote or pointed at is
 * kept by its path, never its contents; a command's output is gathered as
 * it comes, its end kept in the store once the command ends, with its exit.
 */

/** The largest picture kept, in bytes: a screenshot of a long page fits; anything larger is noted, not kept. */
export const PICTURE_KEPT = 20 * 1024 * 1024
/** How much of a command's output is kept: its end, up to this many bytes, cut at a line. */
export const OUTPUT_KEPT = 256 * 1024
/** How much of it goes to a watching client while it runs: its last lines. */
export const OUTPUT_STREAMED = 400

/** A picture as an item keeps it: the artifact and its digest, or why it wasn't kept. */
export interface KeptPicture {
  readonly artifactId: string | null
  readonly sha256: string | null
  readonly mediaType: string
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
  readonly name: string | null
  /** Why it wasn't kept: too large, a kind the window doesn't draw, or no store to keep it in. */
  readonly why?: 'too_large' | 'unsupported' | 'unkept'
}

/** A file an agent wrote, or pointed at: by its path, as it named it. */
export interface FileMention {
  readonly path: string
  readonly how: 'wrote' | 'linked'
  readonly mediaType: string | null
  readonly bytes: number | null
  readonly title: string | null
}

/** A command's output as an item keeps it once it ends: its artifact, or none when it printed nothing. */
export interface KeptOutput {
  readonly artifactId: string | null
  readonly sha256: string | null
  readonly lines: number
  readonly bytes: number
  /** Lines from its start that weren't kept. */
  readonly dropped: number
  /** What the tool said of how it ended, where it failed or was stopped, to its first ERROR_KEPT characters. */
  readonly error: string | null
}

/** How much of what a tool said of a failure is kept, beside its output. */
export const ERROR_KEPT = 2_000

/** Where what is handed back lands: the item, its project, and the folders the agent works in. */
export interface HandedPlace {
  readonly projectId: ProjectId
  readonly itemId: string
  readonly folders: ReadonlyArray<string>
}

/** Base64's bytes; what isn't base64 is passed over, as Node does. */
const decode = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

/** A base64 string's length, as bytes, without decoding it. */
const decodedLength = (base64: string) => Math.floor((base64.replace(/=+$/, '').length * 3) / 4)

const nameOf = (path: string) => path.split(/[\\/]/).findLast((part) => part !== '') ?? path

/** Keeps a picture's bytes, or says why not. */
export const keepPicture = (place: HandedPlace, bytes: Uint8Array, claimed: string, name: string | null) =>
  Effect.gen(function* () {
    const type = pictureType(bytes)
    const unkept = (why: NonNullable<KeptPicture['why']>): KeptPicture => ({
      artifactId: null,
      sha256: null,
      mediaType: type ?? claimed,
      bytes: bytes.length,
      width: null,
      height: null,
      name,
      why,
    })
    if (bytes.length > PICTURE_KEPT) return unkept('too_large')
    if (type === null) return unkept('unsupported')
    const size = pictureSize(bytes, type)
    const artifacts = yield* Artifacts
    const kept = yield* artifacts.keep({
      projectId: place.projectId,
      bytes,
      mediaType: type,
      kind: 'image',
      // A screenshot can show anything on the screen.
      sensitivity: 'may_contain_secrets',
      subject: { type: 'thread_item', id: place.itemId, role: 'image' },
    })
    if (kept === null) return { ...unkept('unkept'), width: size?.width ?? null, height: size?.height ?? null }
    return {
      artifactId: kept.id,
      sha256: kept.sha256,
      mediaType: type,
      bytes: kept.size,
      width: size?.width ?? null,
      height: size?.height ?? null,
      name,
    } satisfies KeptPicture
  })

/** A path an agent named, as a file on this machine: from a `file://` address or a path, against the first folder when relative. */
const pathOf = (uri: string, folders: ReadonlyArray<string>): string | null => {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri)
    } catch {
      return null
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return null
  const [first] = folders
  return isAbsolute(uri) ? uri : first === undefined ? null : resolve(first, uri)
}

/** Whether a file is inside one of the folders, links followed both sides, so none leads out of them. */
export const inside = (path: string, folders: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const real = await realpath(path).catch(() => null)
    if (real === null) return null
    for (const folder of folders) {
      const root = await realpath(folder).catch(() => null)
      if (root !== null && (real === root || real.startsWith(`${root}${sep}`))) return real
    }
    return null
  })

const PICTURE_NAME = /\.(png|jpe?g|gif|webp)$/i

/** Whether a link points at a picture, by its type or its name. */
const pictureLink = (link: Extract<Handed, { _tag: 'Link' }>) =>
  link.mimeType?.startsWith('image/') === true || PICTURE_NAME.test(link.name) || PICTURE_NAME.test(link.uri.replace(/[?#].*$/, ''))

export interface HandedNow {
  readonly pictures: ReadonlyArray<KeptPicture>
  readonly files: ReadonlyArray<FileMention>
}

/**
 * What something handed back becomes: a picture kept, a file noted, or
 * nothing. A picture a link points at is read only from inside the folders
 * the agent works in, or from a `data:` address; a link elsewhere, such as
 * a web page, isn't followed.
 */
export const handedNow = (place: HandedPlace, handed: Handed) =>
  Effect.gen(function* () {
    const none: HandedNow = { pictures: [], files: [] }
    switch (handed._tag) {
      case 'Image': {
        if (decodedLength(handed.data) > PICTURE_KEPT)
          return {
            ...none,
            pictures: [
              {
                artifactId: null,
                sha256: null,
                mediaType: handed.mimeType,
                bytes: decodedLength(handed.data),
                width: null,
                height: null,
                name: handed.uri === undefined ? null : nameOf(handed.uri),
                why: 'too_large',
              } satisfies KeptPicture,
            ],
          }
        const picture = yield* keepPicture(
          place,
          decode(handed.data),
          handed.mimeType,
          handed.uri === undefined ? null : nameOf(handed.uri),
        )
        return { ...none, pictures: [picture] }
      }
      case 'Embedded': {
        if (handed.blob === undefined || handed.mimeType?.startsWith('image/') !== true) return none
        return { ...none, pictures: [yield* keepPicture(place, decode(handed.blob), handed.mimeType, nameOf(handed.uri))] }
      }
      case 'Link': {
        const data = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(handed.uri)
        if (data !== null)
          return { ...none, pictures: [yield* keepPicture(place, decode(data[2] ?? ''), data[1] ?? '', handed.title ?? null)] }
        const path = pathOf(handed.uri, place.folders)
        if (path === null) return none
        const real = yield* inside(path, place.folders)
        if (real === null) return none
        if (pictureLink(handed)) {
          const found = yield* Effect.promise(() => stat(real).catch(() => null))
          if (found === null || !found.isFile()) return none
          if (found.size > PICTURE_KEPT)
            return {
              ...none,
              pictures: [
                {
                  artifactId: null,
                  sha256: null,
                  mediaType: handed.mimeType ?? '',
                  bytes: found.size,
                  width: null,
                  height: null,
                  name: handed.name === handed.uri ? nameOf(real) : handed.name,
                  why: 'too_large',
                } satisfies KeptPicture,
              ],
            }
          const bytes = yield* Effect.promise(() =>
            readFile(real).then(
              (read) => new Uint8Array(read),
              () => new Uint8Array(),
            ),
          )
          return {
            ...none,
            pictures: [yield* keepPicture(place, bytes, handed.mimeType ?? '', handed.name === handed.uri ? nameOf(real) : handed.name)],
          }
        }
        return {
          ...none,
          files: [
            {
              path,
              how: 'linked',
              mediaType: handed.mimeType ?? null,
              bytes: handed.size ?? null,
              title: handed.title ?? null,
            } satisfies FileMention,
          ],
        }
      }
    }
  })

/** Adds what is new to what an item had: pictures by digest (or name, for one not kept), files by path and how. */
export const together = (had: HandedNow, now: HandedNow): HandedNow => ({
  pictures: [
    ...had.pictures,
    ...now.pictures.filter(
      (picture) =>
        !had.pictures.some((known) =>
          picture.sha256 === null
            ? known.sha256 === null && known.name === picture.name && known.bytes === picture.bytes
            : known.sha256 === picture.sha256,
        ),
    ),
  ],
  files: [...had.files, ...now.files.filter((file) => !had.files.some((known) => known.path === file.path && known.how === file.how))],
})

/** A whole file an agent's input writes, as OpenCode's and Claude Code's write tools say it: its path and all of its contents. */
const wroteWhole = (rawInput: unknown): string | null => {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return null
  const input = rawInput as Readonly<Record<string, unknown>>
  if (typeof input.content !== 'string' || 'old_string' in input || 'oldString' in input) return null
  const path = input.file_path ?? input.filePath ?? input.path
  return typeof path === 'string' && path !== '' ? path : null
}

/** What a tool call's content and input hand back, kept: pictures, files it pointed at, and files it wrote whole or made. */
export const handedByTool = (place: HandedPlace, content: ReadonlyArray<ToolContent>, rawInput: unknown, kind: string) =>
  Effect.gen(function* () {
    const [cwd] = place.folders
    // A file named from where the agent works, whole, so it is read from there and not from a repository's root.
    const wrote = (path: string): HandedNow => ({
      pictures: [],
      files: [
        {
          path: isAbsolute(path) || cwd === undefined ? path : resolve(cwd, path),
          how: 'wrote',
          mediaType: null,
          bytes: null,
          title: null,
        },
      ],
    })
    let now: HandedNow = { pictures: [], files: [] }
    for (const entry of content) {
      if (entry._tag === 'Diff') {
        if (entry.created) now = together(now, wrote(entry.path))
      } else if (entry._tag === 'Image' || entry._tag === 'Link' || entry._tag === 'Embedded')
        now = together(now, yield* handedNow(place, entry))
    }
    const whole = kind === 'edit' ? wroteWhole(rawInput) : null
    return whole === null ? now : together(now, wrote(whole))
  })

/**
 * A command's output as it comes, kept to its end: chunks add to it, or,
 * where an agent says it whole each time (OpenCode), it is replaced. Past
 * OUTPUT_KEPT bytes (as UTF-8, as it is kept), it goes from its start, at a
 * line where there is one; whole lines that go are counted, and a line cut
 * part way only once, as it ends.
 */
export class Output {
  text = ''
  dropped = 0
  /** It came in chunks from the agent's terminal, rather than as the tool's own words. */
  terminal = false
  exit: number | null = null
  /** What the tool said of how it ended, where it failed or was stopped: its error, not its output. */
  error: string | null = null
  changed = false
  /** How many bytes the text is, as UTF-8. */
  private bytes = 0

  constructor(readonly itemId: string) {}

  add(chunk: string) {
    this.terminal = true
    this.text += chunk
    this.bytes += Buffer.byteLength(chunk)
    this.trim()
  }

  replace(whole: string) {
    this.text = unfenced(whole)
    this.bytes = Buffer.byteLength(this.text)
    this.dropped = 0
    this.trim()
  }

  private trim() {
    this.changed = true
    if (this.bytes <= OUTPUT_KEPT) return
    const encoded = Buffer.from(this.text)
    let from = encoded.length - OUTPUT_KEPT
    // At the next line where one starts; otherwise, within the last line, at the next whole character.
    const line = encoded.indexOf(0x0a, from)
    if (line !== -1 && line + 1 < encoded.length) from = line + 1
    else while (from < encoded.length && ((encoded[from] ?? 0) & 0xc0) === 0x80) from += 1
    const gone = encoded.subarray(0, from).toString()
    this.dropped += gone.split('\n').length - 1
    this.text = encoded.subarray(from).toString()
    this.bytes = encoded.length - from
  }

  /** Its last lines, for a client watching it run, and how many came before them. */
  tail(): { readonly text: string; readonly dropped: number } {
    const lines = this.text.split('\n')
    if (lines.length <= OUTPUT_STREAMED + 1) return { text: this.text, dropped: this.dropped }
    const shown = lines.slice(-OUTPUT_STREAMED - 1)
    return { text: shown.join('\n'), dropped: this.dropped + lines.length - shown.length }
  }
}

/** How many lines a stretch of output holds: its newlines, and one more for a last line without one. */
export const countLines = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

/** Output an agent wrapped as markdown, as Claude Code does without a terminal (```console … ```), unwrapped. */
const unfenced = (text: string) => {
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return fenced === null ? text : `${fenced[1] ?? ''}\n`
}

/** The whole of what a command printed, where OpenCode's raw output says it: `metadata.output`. */
export const printedIn = (rawOutput: unknown): string | null => {
  const metadata = recordIn(recordIn(rawOutput).metadata)
  return typeof metadata.output === 'string' ? metadata.output : null
}

/** What OpenCode's error report says went wrong: `error`. */
export const errorIn = (rawOutput: unknown): string | null => {
  const error = recordIn(rawOutput).error
  return typeof error === 'string' && error !== '' ? error : null
}

/** The exit code OpenCode puts in a command's raw output: `metadata.exit`. */
export const exitIn = (rawOutput: unknown): number | null => {
  if (typeof rawOutput !== 'object' || rawOutput === null) return null
  const metadata = (rawOutput as Readonly<Record<string, unknown>>).metadata
  if (typeof metadata !== 'object' || metadata === null) return null
  const exit = (metadata as Readonly<Record<string, unknown>>).exit
  return typeof exit === 'number' ? exit : null
}

/** Keeps a command's output once it ends, in the store; nothing printed is kept as no artifact. */
export const keepOutput = (place: HandedPlace, output: Output) =>
  Effect.gen(function* () {
    const bytes = new TextEncoder().encode(output.text)
    const counted = {
      lines: countLines(output.text),
      bytes: bytes.length,
      dropped: output.dropped,
      error: output.error === null ? null : output.error.slice(0, ERROR_KEPT),
    }
    if (output.text === '') return { artifactId: null, sha256: null, ...counted } satisfies KeptOutput
    const artifacts = yield* Artifacts
    const kept = yield* artifacts.keep({
      projectId: place.projectId,
      bytes,
      mediaType: 'text/plain; charset=utf-8',
      kind: 'log',
      // What a command prints can hold anything: a token, a password.
      sensitivity: 'may_contain_secrets',
      subject: { type: 'thread_item', id: place.itemId, role: 'output' },
    })
    return { artifactId: kept?.id ?? null, sha256: kept?.sha256 ?? null, ...counted } satisfies KeptOutput
  })

/* ---- What an item keeps, as the contract has it ---- */

const recordIn = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
const stringIn = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const numberIn = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const UNKEPT = ['too_large', 'unsupported', 'unkept'] as const

/** The pictures an item keeps, as a screen shows them: by digest, or why not kept. */
export const picturesOf = (value: unknown): ReadonlyArray<Picture> =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const picture = recordIn(entry)
    const digest = stringIn(picture.sha256)
    const why = UNKEPT.find((reason) => reason === picture.why)
    if (digest === null && why === undefined) return []
    return [
      {
        digest: why === undefined ? digest : null,
        mediaType: stringIn(picture.mediaType) ?? '',
        bytes: numberIn(picture.bytes) ?? 0,
        width: numberIn(picture.width),
        height: numberIn(picture.height),
        name: stringIn(picture.name),
        unkept: why ?? null,
      },
    ]
  })

/** The files an item names, as a screen shows them. */
export const filesOf = (value: unknown): ReadonlyArray<ContractFile> =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const file = recordIn(entry)
    const path = stringIn(file.path)
    if (path === null || path === '' || (file.how !== 'wrote' && file.how !== 'linked')) return []
    return [{ path, how: file.how, mediaType: stringIn(file.mediaType), bytes: numberIn(file.bytes), title: stringIn(file.title) }]
  })

/** A command's output, as an item keeps it once it ended; null before it ends, or for a call that isn't a command. */
export const outputOf = (value: unknown): CommandOutput | null => {
  if (value === undefined || value === null) return null
  const output = recordIn(value)
  return {
    kept: stringIn(output.sha256) !== null,
    lines: numberIn(output.lines) ?? 0,
    bytes: numberIn(output.bytes) ?? 0,
    dropped: numberIn(output.dropped) ?? 0,
    error: stringIn(output.error),
  }
}
