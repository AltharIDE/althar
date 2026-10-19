import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

/*
 * One of the app's log files (docs/architecture/02): main.log, runtime.log
 * or agents.log, in the folder the system keeps logs in. Each process kind
 * has its own file and is its only writer. Lines are stamped with the time
 * they were written. A file that grows past its size starts afresh, the old
 * one kept beside it as name.1.log, name.2.log and so on, up to a few;
 * anything older than a week goes as the file is opened or turned over. Writes
 * are synchronous and small, so a line written just before a crash is there.
 * What goes in is the caller's to keep quiet: lifecycle, errors, and each
 * turn's start and end by its ids, never what anyone wrote.
 */

/** How long a log is kept: about a week. */
export const KEPT_FOR = 7 * 24 * 60 * 60 * 1000

/** A line longer than this is cut, so one runaway line can't fill the file. */
export const LONGEST_LINE = 4_000

export interface LogFileOptions {
  readonly dir: string
  /** The process kind: main, runtime, agents. */
  readonly name: string
  /** The size the file turns over at: 2 MB unless said. */
  readonly maxBytes?: number
  /** How many earlier files are kept beside it: 4 unless said. */
  readonly keep?: number
  /** How long anything is kept: a week unless said. */
  readonly keptFor?: number
  readonly now?: () => number
}

export type Level = 'INFO' | 'WARN' | 'ERROR'

export type Fields = Readonly<Record<string, string | number | boolean | null | undefined>>

export interface LogFile {
  readonly path: string
  /** One line in the logfmt the runtime writes too: level, message, then each field as key=value. */
  line(level: Level, message: string, fields?: Fields): void
  /** Text as it came, a line at a time, each stamped; `tag` goes after the stamp, as an agent's name does. */
  raw(text: string, tag?: string): void
  /** A writer for a stream that comes in pieces, as a process's stderr does: whole lines only, the rest held until its end comes. */
  stream(tag?: string): { readonly write: (chunk: string) => void; readonly end: () => void }
  close(): void
}

/** A value as logfmt has it: bare when it can be, quoted otherwise. */
const value = (raw: string | number | boolean | null): string => {
  const text = String(raw)
  return text !== '' && /^[\w.:/@+-]+$/.test(text) ? text : JSON.stringify(text)
}

/** The logfmt part of a line: level, message and fields, on one line whatever they hold. */
export const logfmt = (level: Level, message: string, fields: Fields = {}): string =>
  [
    `level=${level}`,
    `message=${value(message)}`,
    ...Object.entries(fields).flatMap(([key, field]) => (field === undefined ? [] : [`${key}=${value(field)}`])),
  ].join(' ')

/** The file names this log has kept, the current one first: name.log, name.1.log, … */
const rotated = (name: string, keep: number) => [`${name}.log`, ...Array.from({ length: keep }, (_, i) => `${name}.${i + 1}.log`)]

/** Its files on disk, oldest last, as `tail` reads them. */
export const logFilesOf = (dir: string, name: string, keep = 4): ReadonlyArray<string> => rotated(name, keep).map((file) => join(dir, file))

export const openLogFile = ({ dir, name, maxBytes = 2_000_000, keep = 4, keptFor = KEPT_FOR, now = Date.now }: LogFileOptions): LogFile => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.log`)
  const files = rotated(name, keep).map((file) => join(dir, file))

  /** Removes what is older than it is kept for, and anything beyond the files it keeps. */
  const prune = () => {
    const ours = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.log$`)
    for (const entry of readdirSync(dir)) {
      const numbered = ours.exec(entry)
      if (numbered === null) continue
      const file = join(dir, entry)
      const old = Number(numbered[1]) > keep || now() - statSync(file).mtimeMs > keptFor
      if (old) unlinkSync(file)
    }
  }

  /** The current file becomes name.1.log, each before it one further on, and the last goes. */
  const turnOver = () => {
    for (let i = files.length - 1; i > 0; i--) {
      const from = files[i - 1]
      const to = files[i]
      if (from === undefined || to === undefined) continue
      try {
        renameSync(from, to)
      } catch {
        // Not there yet.
      }
    }
  }

  // A file last written to more than a week ago starts afresh, so a quiet app's log doesn't hold old lines forever.
  try {
    if (now() - statSync(path).mtimeMs > keptFor) turnOver()
  } catch {
    // No file yet.
  }
  prune()

  let fd = openSync(path, 'a')
  let size = fstatSync(fd).size
  let closed = false

  const append = (text: string) => {
    if (closed) return
    const bytes = Buffer.from(text)
    if (size > 0 && size + bytes.length > maxBytes) {
      closeSync(fd)
      turnOver()
      prune()
      fd = openSync(path, 'a')
      size = 0
    }
    writeSync(fd, bytes)
    size += bytes.length
  }

  const cut = (text: string) => (text.length > LONGEST_LINE ? `${text.slice(0, LONGEST_LINE)}…` : text)
  const stamp = () => new Date(now()).toISOString()

  const raw = (text: string, tag?: string) => {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    append(lines.map((each) => `${stamp()} ${tag === undefined ? '' : `${tag} `}${cut(each)}\n`).join(''))
  }

  return {
    path,
    line: (level, message, fields) => append(`${stamp()} ${cut(logfmt(level, message, fields))}\n`),
    raw,
    stream: (tag) => {
      let held = ''
      return {
        write: (chunk) => {
          const text = held + chunk
          const end = text.lastIndexOf('\n')
          if (end === -1) {
            held = text
            // A line with no end in sight is written as it is once it is long enough to cut anyway.
            if (text.length > LONGEST_LINE) {
              raw(text, tag)
              held = ''
            }
            return
          }
          held = text.slice(end + 1)
          raw(text.slice(0, end), tag)
        },
        end: () => {
          if (held !== '') raw(held, tag)
          held = ''
        },
      }
    },
    close: () => {
      if (closed) return
      closed = true
      closeSync(fd)
    },
  }
}

/**
 * The last `bytes` of a log, from its current file and, where that is short,
 * the one before it, starting at a whole line. Empty where there is none.
 */
export const tail = (dir: string, name: string, bytes: number, keep = 4): string => {
  const parts: Array<string> = []
  let wanted = bytes
  for (const file of logFilesOf(dir, name, keep)) {
    if (wanted <= 0) break
    let fd: number
    try {
      fd = openSync(file, 'r')
    } catch {
      continue
    }
    try {
      const { size } = fstatSync(fd)
      const length = Math.min(size, wanted)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      parts.unshift(buffer.toString('utf8'))
      wanted -= length
    } finally {
      closeSync(fd)
    }
  }
  const text = parts.join('')
  // Cut where it began mid-line, unless it holds the whole of the oldest file it read.
  const start = wanted <= 0 ? text.indexOf('\n') + 1 : 0
  return text.slice(start)
}
