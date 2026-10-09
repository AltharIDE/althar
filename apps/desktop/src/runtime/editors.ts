import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { locate } from '@althar/provider-adapters'
import { Effect } from 'effect'

/*
 * The editors on this computer that a task's files open in: found, opened
 * on the task's folder and, where the editor can be told, at a file and
 * line. On a Mac by their app; on Windows and Linux by the command each
 * puts on the PATH (`code`, `cursor`, `zed`). The system's file manager is
 * always there, to show the file: Finder, File Explorer, or Files. Nothing
 * is installed or configured; an editor not found isn't offered.
 */

interface Known {
  readonly id: string
  readonly name: string
  /** Its bundle on a Mac, in /Applications or ~/Applications. */
  readonly app?: string
  /** A link that opens a file at a line on a Mac, for an editor that takes one. */
  readonly at?: (path: string, line: number) => string
  /** Its command on Windows and Linux, and how that command is told a file and line. */
  readonly cli?: { readonly name: string; readonly line: 'goto' | 'colon' | 'flag' | 'none' }
}

/** A link to a file at a line: each part of its path encoded, so a `#` or `?` in a name stays part of it. */
export const fileLink = (scheme: string) => (path: string, line: number) =>
  `${scheme}://file${path.split('/').map(encodeURIComponent).join('/')}:${line}`

const KNOWN: ReadonlyArray<Known> = [
  { id: 'cursor', name: 'Cursor', app: 'Cursor.app', at: fileLink('cursor'), cli: { name: 'cursor', line: 'goto' } },
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code.app', at: fileLink('vscode'), cli: { name: 'code', line: 'goto' } },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf.app', at: fileLink('windsurf'), cli: { name: 'windsurf', line: 'goto' } },
  { id: 'zed', name: 'Zed', app: 'Zed.app', at: fileLink('zed'), cli: { name: 'zed', line: 'colon' } },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text.app', cli: { name: 'subl', line: 'colon' } },
  { id: 'idea', name: 'IntelliJ IDEA', app: 'IntelliJ IDEA.app', cli: { name: 'idea', line: 'flag' } },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm.app', cli: { name: 'webstorm', line: 'flag' } },
  { id: 'pycharm', name: 'PyCharm', app: 'PyCharm.app', cli: { name: 'pycharm', line: 'flag' } },
  { id: 'goland', name: 'GoLand', app: 'GoLand.app', cli: { name: 'goland', line: 'flag' } },
  { id: 'rustrover', name: 'RustRover', app: 'RustRover.app', cli: { name: 'rustrover', line: 'flag' } },
  { id: 'xcode', name: 'Xcode', app: 'Xcode.app' },
  { id: 'nova', name: 'Nova', app: 'Nova.app' },
  { id: 'bbedit', name: 'BBEdit', app: 'BBEdit.app' },
]

/** The system's file manager, which shows the file rather than opening it. */
export const fileManagerOf = (platform: NodeJS.Platform) =>
  platform === 'darwin'
    ? ({ id: 'finder', name: 'Finder' } as const)
    : platform === 'win32'
      ? ({ id: 'explorer', name: 'File Explorer' } as const)
      : ({ id: 'files', name: 'Files' } as const)

const MANAGERS = new Set(['finder', 'explorer', 'files'])

/** Where Finder is, for its picture. */
const FINDER_APP = '/System/Library/CoreServices/Finder.app'

const run = (command: string, args: ReadonlyArray<string>) =>
  Effect.callback<boolean>((resume) => {
    execFile(command, [...args], (error) => resume(Effect.succeed(error === null)))
  })

/**
 * Starts an editor's command and leaves it running. On Windows an editor's
 * command is often a `.cmd`, which only a shell runs, so it goes through
 * one, each argument quoted; a path with a quote in it is refused, as no
 * quoting makes it safe there.
 */
export const start = (command: string, args: ReadonlyArray<string>, platform: NodeJS.Platform = process.platform) =>
  Effect.callback<boolean>((resume) => {
    const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(command)
    if (shell && [command, ...args].some((part) => part.includes('"') || part.includes('%'))) return resume(Effect.succeed(false))
    const child = shell
      ? spawn(
          `"${command}"`,
          args.map((part) => `"${part}"`),
          { shell: true, detached: true, stdio: 'ignore', windowsHide: true },
        )
      : spawn(command, [...args], { detached: true, stdio: 'ignore' })
    child.once('error', () => resume(Effect.succeed(false)))
    child.once('spawn', () => {
      child.unref()
      resume(Effect.succeed(true))
    })
  })

/** Where an editor's command is on Windows or Linux: the person's, on the PATH or where installers put it; null where it isn't. */
const commandOf = (known: Known, platform: NodeJS.Platform): string | null =>
  known.cli === undefined ? null : (locate(known.cli.name, { bundled: null, kept: null }, { platform })?.command ?? null)

/** The editors found here, in the order they are offered, then the file manager. */
export const editorsHere = (
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
  find: (known: Known) => string | null = (known) => commandOf(known, platform),
): ReadonlyArray<{ readonly id: string; readonly name: string }> => {
  const found =
    platform === 'darwin'
      ? KNOWN.filter(
          (editor) =>
            editor.app !== undefined && ['/Applications', join(home, 'Applications')].some((dir) => exists(join(dir, editor.app ?? ''))),
        )
      : KNOWN.filter((editor) => find(editor) !== null)
  return [...found.map(({ id, name }) => ({ id, name })), fileManagerOf(platform)]
}

/**
 * Where an editor found here is on a Mac, by its id, for the main process to
 * draw its icon: the first of /Applications and ~/Applications that has it,
 * and Finder's own place; null for one it doesn't know or can't find, and
 * off a Mac, where an editor is drawn by its first letter.
 */
export const bundleOf = (
  id: string,
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null => {
  if (platform !== 'darwin') return null
  if (id === 'finder') return FINDER_APP
  const known = KNOWN.find((editor) => editor.id === id)
  if (known?.app === undefined) return null
  return ['/Applications', join(home, 'Applications')].map((dir) => join(dir, known.app ?? '')).find((path) => exists(path)) ?? null
}

/** How an editor's command is told to open a file at a line. */
export const argsAt = (line: 'goto' | 'colon' | 'flag' | 'none', file: string, at: number): ReadonlyArray<string> => {
  switch (line) {
    case 'goto':
      return ['-g', `${file}:${at}`]
    case 'colon':
      return [`${file}:${at}`]
    case 'flag':
      return ['--line', String(at), file]
    default:
      return [file]
  }
}

/** Shows a file, or the folder, in the system's file manager. */
const reveal = (platform: NodeJS.Platform, folder: string, file: string | null) =>
  platform === 'darwin'
    ? run('open', ['-R', file ?? folder])
    : platform === 'win32'
      ? start('explorer.exe', file === null ? [folder] : [`/select,${file}`], platform)
      : run('xdg-open', [file === null ? folder : dirname(file)])

/**
 * Opens the task's folder in the editor, then the file, at its line where
 * the editor takes one; the file manager shows the file, or the folder.
 */
export const openInEditor = (
  editor: string,
  folder: string,
  file: string | null,
  line: number | null,
  platform: NodeJS.Platform = process.platform,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (MANAGERS.has(editor)) return yield* reveal(platform, folder, file)
    const known = KNOWN.find((candidate) => candidate.id === editor)
    if (known === undefined) return false
    if (platform === 'darwin') {
      if (known.app === undefined) return false
      const app = known.app.replace(/\.app$/, '')
      const opened = yield* run('open', ['-a', app, folder])
      if (!opened || file === null) return opened
      return yield* known.at === undefined ? run('open', ['-a', app, file]) : run('open', [known.at(file, line ?? 1)])
    }
    const command = commandOf(known, platform)
    if (command === null || known.cli === undefined) return false
    const opened = yield* start(command, [folder], platform)
    if (!opened || file === null) return opened
    return yield* start(command, argsAt(known.cli.line, file, line ?? 1), platform)
  })
