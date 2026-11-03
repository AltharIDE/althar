import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Where an agent's shell is now. Its shell keeps the folder a `cd` took it
 * to from one command to the next, and a permission request doesn't say
 * where that is, so a rule reading `rm ../../x.log` from the worktree's top
 * misreads what a lead in `packages/ui` meant. Claude Code writes the
 * folder on every entry of its session's transcript (`cwd`), so the last
 * entry says where its next command runs.
 */

/** How much of a transcript's end is read: its last entries, each a line of JSON, where the newest `cwd` is. */
const TAIL = 256 * 1024

/** Claude Code's name for a project's folder of transcripts: its path with every other character than a letter or digit a dash. */
const projectName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/** The end of a file, as text; none where it can't be read. */
const tailOf = (path: string): string | undefined => {
  let handle: number | undefined
  try {
    handle = openSync(path, 'r')
    const size = fstatSync(handle).size
    const length = Math.min(size, TAIL)
    const buffer = Buffer.alloc(length)
    readSync(handle, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

/**
 * The transcript of a Claude Code session in `home` (its `CLAUDE_CONFIG_DIR`)
 * started in `cwd`: in its project's folder, or, where Claude Code shortened
 * a long path's name, whichever project's folder holds it.
 */
const transcriptOf = (home: string, cwd: string, sessionId: string): string | undefined => {
  const file = `${sessionId}.jsonl`
  const named = join(home, 'projects', projectName(cwd), file)
  if (existsSync(named)) return named
  try {
    const found = readdirSync(join(home, 'projects')).find((folder) => existsSync(join(home, 'projects', folder, file)))
    return found === undefined ? undefined : join(home, 'projects', found, file)
  } catch {
    return undefined
  }
}

/** The newest `cwd` among a transcript's lines, read from its end. */
const lastFolder = (text: string): string | undefined => {
  const lines = text.split('\n')
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at] ?? ''
    if (!line.includes('"cwd"')) continue
    try {
      const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch {
      // The tail's first line is cut short; any other that isn't JSON says nothing either.
    }
  }
  return undefined
}

/**
 * Where a Claude Code session's shell is now, as its transcript says; none
 * where there is no transcript yet or it names no folder. The transcript is
 * found once and read again on each call.
 */
export const claudeShellFolder = (home: string, cwd: string, sessionId: string): (() => string | undefined) => {
  let transcript: string | undefined
  return () => {
    transcript ??= transcriptOf(home, cwd, sessionId)
    if (transcript === undefined) return undefined
    const text = tailOf(transcript)
    return text === undefined ? undefined : lastFolder(text)
  }
}
