import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'

/*
 * The editors on this Mac that a task's files open in: found by their app,
 * opened on the task's folder and, where the editor can be told, at a file
 * and line. Finder is always there, to show the file. Nothing is installed
 * or configured; an editor not found isn't offered.
 */

interface Known {
  readonly id: string
  readonly name: string
  /** Its bundle, in /Applications or ~/Applications. */
  readonly app: string
  /** A link that opens a file at a line, for an editor that takes one. */
  readonly at?: (path: string, line: number) => string
}

/** A link to a file at a line: each part of its path encoded, so a `#` or `?` in a name stays part of it. */
export const fileLink = (scheme: string) => (path: string, line: number) =>
  `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}:${line}`

const KNOWN: ReadonlyArray<Known> = [
  { id: 'cursor', name: 'Cursor', app: 'Cursor.app', at: fileLink('cursor') },
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code.app', at: fileLink('vscode') },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf.app', at: fileLink('windsurf') },
  { id: 'zed', name: 'Zed', app: 'Zed.app', at: fileLink('zed') },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text.app' },
  { id: 'idea', name: 'IntelliJ IDEA', app: 'IntelliJ IDEA.app' },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm.app' },
  { id: 'pycharm', name: 'PyCharm', app: 'PyCharm.app' },
  { id: 'goland', name: 'GoLand', app: 'GoLand.app' },
  { id: 'rustrover', name: 'RustRover', app: 'RustRover.app' },
  { id: 'xcode', name: 'Xcode', app: 'Xcode.app' },
  { id: 'nova', name: 'Nova', app: 'Nova.app' },
  { id: 'bbedit', name: 'BBEdit', app: 'BBEdit.app' },
]

/** Finder, which shows the file rather than opening it. */
const FINDER = { id: 'finder', name: 'Finder' } as const

const run = (args: ReadonlyArray<string>) =>
  Effect.callback<boolean>((resume) => {
    execFile('open', [...args], (error) => resume(Effect.succeed(error === null)))
  })

/** Where Finder is, for its picture. */
const FINDER_APP = '/System/Library/CoreServices/Finder.app'

/**
 * Where an editor found here is, by its id, for the main process to draw its
 * icon: the first of /Applications and ~/Applications that has it, and
 * Finder's own place; null for one Althar doesn't know or can't find.
 */
export const bundleOf = (id: string, home = homedir(), exists: (path: string) => boolean = existsSync): string | null => {
  if (id === FINDER.id) return FINDER_APP
  const known = KNOWN.find((editor) => editor.id === id)
  if (known === undefined) return null
  return ['/Applications', join(home, 'Applications')].map((dir) => join(dir, known.app)).find((path) => exists(path)) ?? null
}

/** The editors found here, in the order they are offered, then Finder; none away from a Mac. */
export const editorsHere = (
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): ReadonlyArray<{ readonly id: string; readonly name: string }> =>
  platform !== 'darwin'
    ? []
    : [
        ...KNOWN.filter((editor) => ['/Applications', join(home, 'Applications')].some((dir) => exists(join(dir, editor.app)))).map(
          ({ id, name }) => ({ id, name }),
        ),
        FINDER,
      ]

/**
 * Opens the task's folder in the editor, then the file, at its line where
 * the editor takes a link for that; Finder shows the file, or the folder.
 */
export const openInEditor = (editor: string, folder: string, file: string | null, line: number | null): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (process.platform !== 'darwin') return false
    if (editor === FINDER.id) return yield* run(['-R', file ?? folder])
    const known = KNOWN.find((candidate) => candidate.id === editor)
    if (known === undefined) return false
    const app = known.app.replace(/\.app$/, '')
    const opened = yield* run(['-a', app, folder])
    if (!opened || file === null) return opened
    return yield* known.at === undefined ? run(['-a', app, file]) : run([known.at(file, line ?? 1)])
  })
