import type { ThreadSnapshot } from '@althar/contracts'
import { NoOutputs } from '@althar/ui'

/*
 * A task's outputs before it has made anything (its Outputs face is always
 * there, so the switch never moves): what is true, by how the task stands,
 * and the files its lead has looked at, the latest first.
 */

export const text = {
  yet: 'Nothing changed yet',
  none: 'Nothing changed',
  working: (lead: string) => `What ${lead} changes shows here as it goes.`,
  planned: 'It starts when its plan does. What its lead changes shows here.',
  stopped: (lead: string) => `${lead} stopped before changing anything. Tell it to carry on in the conversation.`,
  ended: 'It ended without changing a file. What it found is in the conversation.',
}

/** Commands that read the files they are given, and those of theirs that take a value, which isn't a file. */
const READERS: Readonly<Record<string, ReadonlySet<string>>> = {
  cat: new Set(),
  nl: new Set(['-b', '-s', '-w', '-v', '-i']),
  head: new Set(['-n', '-c']),
  tail: new Set(['-n', '-c']),
  less: new Set(),
  bat: new Set(['-r', '--line-range', '-l', '--language']),
  wc: new Set(),
  sed: new Set(['-e', '-f']),
}

/** A line's commands, as `;`, `&&`, `||`, `|` and new lines part them, outside quotes. */
const commandsOf = (line: string): string[] => {
  const parts: string[] = []
  let part = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? ''
    if (quote !== null) {
      if (c === quote) quote = null
      part += c
    } else if (c === "'" || c === '"') {
      quote = c
      part += c
    } else if (c === ';' || c === '|' || c === '\n' || (c === '&' && line[i + 1] === '&')) {
      if (line[i + 1] === c) i += 1
      parts.push(part)
      part = ''
    } else part += c
  }
  return [...parts, part]
}

/** Words as a shell splits them, near enough: quotes kept together, not expanded. */
const wordsOf = (line: string): string[] => [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')

/**
 * The files a shell command reads, as an agent runs them to look at code:
 * `cat a b`, `sed -n '1,80p' a`, `nl -ba a | sed -n '1,40p'`, `head -n 20 a`,
 * one after another with `;`, `&&` or `|`, and inside `zsh -lc "…"`. Anything
 * else (a script, a glob, a variable) says nothing.
 */
export const readsOf = (command: string): ReadonlyArray<string> => {
  const inner = /^\s*\/?(?:bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(command)
  const line = inner?.[2] ?? command
  const files: string[] = []
  for (const part of commandsOf(line)) {
    const [name, ...args] = wordsOf(part.trim())
    const valued = name === undefined ? undefined : READERS[name]
    // sed told to edit in place writes, rather than reads.
    if (valued === undefined || (name === 'sed' && args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith('--in-place')))) continue
    // sed's first word that isn't an option is its script, unless -e gave it one.
    let script = name === 'sed' && !args.includes('-e')
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? ''
      if (arg.startsWith('-')) {
        if (valued.has(arg)) i += 1
        continue
      }
      if (script) {
        script = false
        continue
      }
      if (/[*?{}$<>()`]/.test(arg) || !/[./]/.test(arg) || /^\d/.test(arg)) continue
      files.push(arg)
    }
  }
  return files
}

/**
 * The files a task's lead has looked at, the latest first, each once, as
 * paths in the task's folder: those its tools said they read, and those its
 * shell commands read. Its own files elsewhere (an agent's memory, its
 * settings) aren't the task's, and aren't listed.
 */
export const lookedOf = (snapshot: ThreadSnapshot): ReadonlyArray<string> => {
  const root = (snapshot.task.worktree ?? '').replace(/\/$/, '')
  const inside = (path: string) => {
    if (path.startsWith('/')) return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null
    const relative = path.replace(/^\.\//, '')
    return relative.startsWith('../') || relative.startsWith('~') ? null : relative
  }
  const seen = new Set<string>()
  for (const item of snapshot.items.toReversed()) {
    if (item.kind !== 'tool_call') continue
    const paths = [
      ...item.content.locations.map((location) => location.path),
      ...(item.content.command === null ? [] : readsOf(item.content.command).toReversed()),
    ]
    for (const path of paths) {
      const shown = inside(path)
      if (shown !== null && shown !== '') seen.add(shown)
    }
  }
  return [...seen]
}

/** What it says and shows, by how it stands. */
export const noOutputsOf = (snapshot: ThreadSnapshot, lead: string) => {
  const { task } = snapshot
  const working = snapshot.session?.turnRunning === true
  const [title, note] =
    task.phase === 'ready' || task.phase === 'settled'
      ? [text.none, text.ended]
      : working || task.phase === 'running' || task.phase === 'waiting'
        ? [text.yet, text.working(lead)]
        : task.phase === 'planned' || task.phase === 'held'
          ? [text.yet, text.planned]
          : [text.yet, text.stopped(lead)]
  return { title, note, working, looked: lookedOf(snapshot) }
}

export function NoOutputsView({ snapshot, lead }: { snapshot: ThreadSnapshot; lead: string }) {
  return <NoOutputs {...noOutputsOf(snapshot, lead)} />
}
