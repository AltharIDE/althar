import {
  close as closeFd,
  closeSync,
  fstatSync,
  mkdirSync,
  open as openFd,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  write as writeFd,
  writeSync,
} from 'node:fs'
import { readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * One of the app's log files (docs/architecture/02): main.log, runtime.log
 * or agents.log, in the folder the system keeps logs in. Each process kind
 * has its own file and is its only writer. Lines are stamped with the time
 * they were written. A file that grows past its size starts afresh, the old
 * one kept beside it as name.1.log, name.2.log and so on, up to a few;
 * anything older than a week goes as the file is opened or turned over. What
 * goes in is the caller's to keep quiet: lifecycle, errors, and each turn's
 * start and end by its ids, never what anyone wrote.
 *
 * The processes that write them answer the person (the main process draws
 * every window, the runtime answers every call), so a line never waits for
 * the disk where it is written: the lines of a tick go together once it is
 * over, and the disk is waited for off the thread. So is turning over, which
 * renames and removes files. As the process exits, what hasn't reached the
 * disk yet is written at once, so a line written just before a crash is
 * there all the same.
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
  /** Calls `flush` as the process exits, until the returned function is called: the process's own `exit` unless a test says. */
  readonly atExit?: (flush: () => void) => () => void
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
  /** Once everything written so far is on disk. */
  flushed(): Promise<void>
  /** Writes what hasn't reached the disk yet, at once: as the process exits, where nothing can wait. */
  flushNow(): void
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

/** The process's own exit. */
const processExit = (flush: () => void) => {
  process.on('exit', flush)
  return () => void process.off('exit', flush)
}

const opened = (path: string) =>
  new Promise<number>((resolve, reject) => openFd(path, 'a', (error, fd) => (error === null ? resolve(fd) : reject(error))))
const closed = (fd: number) => new Promise<void>((resolve) => closeFd(fd, () => resolve()))
const written = (fd: number, bytes: Buffer) =>
  new Promise<number>((resolve, reject) =>
    writeFd(fd, bytes, 0, bytes.length, null, (error, count) => (error === null ? resolve(count) : reject(error))),
  )

/** A batch of lines on its way to the disk: its bytes, and the size the file had before them. */
interface Batch {
  readonly bytes: Buffer
  readonly from: number
}

export const openLogFile = ({
  dir,
  name,
  maxBytes = 2_000_000,
  keep = 4,
  keptFor = KEPT_FOR,
  now = Date.now,
  atExit = processExit,
}: LogFileOptions): LogFile => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.log`)
  const files = rotated(name, keep).map((file) => join(dir, file))
  const ours = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.log$`)
  const old = (entry: string, modified: number) => Number(ours.exec(entry)?.[1]) > keep || now() - modified > keptFor

  /** Removes what is older than it is kept for, and anything beyond the files it keeps: as it opens, before anything answers. */
  const pruneNow = () => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry)
      if (ours.test(entry) && old(entry, statSync(file).mtimeMs)) unlinkSync(file)
    }
  }
  /** The same, off the thread, as it turns over. */
  const prune = async () => {
    for (const entry of await readdir(dir)) {
      const file = join(dir, entry)
      if (ours.test(entry) && old(entry, (await stat(file).catch(() => ({ mtimeMs: now() }))).mtimeMs))
        await unlink(file).catch(() => undefined)
    }
  }

  /** Each file and the name it takes as the log turns over, the oldest first: the current one becomes name.1.log, and the last goes. */
  const moves = files
    .slice(1)
    .map((to, i) => [files[i] ?? to, to] as const)
    .toReversed()
  const turnOverNow = () => {
    for (const [from, to] of moves) {
      try {
        renameSync(from, to)
      } catch {
        // Not there yet.
      }
    }
  }
  const turnOver = async () => {
    for (const [from, to] of moves) await rename(from, to).catch(() => undefined)
  }

  // A file last written to more than a week ago starts afresh, so a quiet app's log doesn't hold old lines forever.
  try {
    if (now() - statSync(path).mtimeMs > keptFor) turnOverNow()
  } catch {
    // No file yet.
  }
  pruneNow()

  let fd = openSync(path, 'a')
  /** The file's size once what is on its way has landed. */
  let size = fstatSync(fd).size
  let ended = false
  /** Lines not yet on their way to the disk. */
  let held: Array<Buffer> = []
  /** The batch on its way to the disk. */
  let current: Batch | undefined
  /** Whether the file is being turned over: its descriptor closed, and another to be opened. */
  let turning = false
  /** Whether a write is asked for after this tick, or under way. */
  let busy = false
  /** Closed while a batch was on its way: what is held goes after it, and the descriptor is closed once all of it has landed. */
  let closeAfter = false
  const drained: Array<() => void> = []

  /** Closes the file, moves each before it one further on, prunes, and opens a fresh one: off the thread, while the lines wait. */
  const turn = async () => {
    turning = true
    await closed(fd)
    await turnOver()
    await prune().catch(() => undefined)
    const next = await opened(path).catch(() => null)
    if (!turning) {
      // Written at once meanwhile, as the process exits, to a file opened for it: this one isn't needed.
      if (next !== null) closeFd(next, () => undefined)
      return
    }
    turning = false
    size = 0
    // Without a file to write to, what follows fails to write, and is let go.
    fd = next ?? -1
  }

  /** Writes what is held, as much at a time as fits in the file, turning it over first where the next line wouldn't. */
  const drain = async () => {
    try {
      while (held.length > 0 && (!ended || closeAfter)) {
        if (size > 0 && size + (held[0]?.length ?? 0) > maxBytes) {
          await turn()
          continue
        }
        let count = 0
        let length = 0
        for (const one of held) {
          if (count > 0 && size + length + one.length > maxBytes) break
          count += 1
          length += one.length
        }
        const batch: Batch = { bytes: Buffer.concat(held.splice(0, count)), from: size }
        current = batch
        size += length
        try {
          for (let done = 0; done < length;) done += await written(fd, batch.bytes.subarray(done))
        } catch {
          // A log that can't be written to is no reason to stop what was logging.
        }
        if (current === batch) current = undefined
      }
    } finally {
      busy = false
      if (closeAfter) closeFd(fd, () => undefined)
      for (const resolve of drained.splice(0)) resolve()
    }
  }

  const append = (text: string) => {
    if (ended) return
    held.push(Buffer.from(text))
    if (busy) return
    busy = true
    // The lines of this tick go together, once it is over.
    setImmediate(() => void drain())
  }

  /**
   * What hasn't reached the disk yet, written at once: the batch on its way, as far as the file says it hasn't landed,
   * then what is held. The write already asked for may land too, after: a line twice as the process exits rather than none.
   */
  const flushNow = () => {
    try {
      if (turning) {
        // Its descriptor is closed: what is held goes to the file by its name.
        turning = false
        fd = openSync(path, 'a')
        size = fstatSync(fd).size
      }
      if (current !== undefined) {
        const landed = fstatSync(fd).size - current.from
        if (landed < current.bytes.length) writeSync(fd, current.bytes.subarray(Math.max(0, landed)))
        current = undefined
      }
      const rest = Buffer.concat(held)
      held = []
      if (rest.length > 0) writeSync(fd, rest)
      size += rest.length
    } catch {
      // As above: nothing to be done about a log that can't be written.
    }
  }
  const unwatch = atExit(flushNow)

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
      let rest = ''
      return {
        write: (chunk) => {
          const text = rest + chunk
          const end = text.lastIndexOf('\n')
          if (end === -1) {
            rest = text
            // A line with no end in sight is written as it is once it is long enough to cut anyway.
            if (text.length > LONGEST_LINE) {
              raw(text, tag)
              rest = ''
            }
            return
          }
          rest = text.slice(end + 1)
          raw(text.slice(0, end), tag)
        },
        end: () => {
          if (rest !== '') raw(rest, tag)
          rest = ''
        },
      }
    },
    flushed: () => (busy ? new Promise<void>((resolve) => drained.push(resolve)) : Promise.resolve()),
    flushNow,
    close: () => {
      if (ended) return
      ended = true
      unwatch()
      // A batch on its way lands first, then what is held after it, and only then is the descriptor closed: closed
      // under it, the write would land in whatever took its number.
      if (current !== undefined) closeAfter = true
      else {
        flushNow()
        closeSync(fd)
      }
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
