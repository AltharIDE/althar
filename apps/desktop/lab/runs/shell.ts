import type { Folder, Repository, Shell, World } from './world'

/*
 * What the lab's terminals answer: a few commands an engineer would type to
 * see why a run failed and put it right, made up but true to life. bun install
 * brings althar-mobile's lockfile up to date, so the next iOS run gets past
 * it; bun run check finds the type error; bun run ios runs until Ctrl+C.
 * Anything else isn't found, as a shell says. README.md lists them.
 */

export interface Play {
  readonly steps: ReadonlyArray<{ readonly after: number; readonly line: string }>
  /** Its exit code; null for one that runs until it is stopped. */
  readonly exit: number | null
  readonly clear?: boolean
  readonly close?: boolean
  /** Where it leaves the terminal: a folder within it, or another repository. */
  readonly cwd?: string
  readonly folder?: Folder
  readonly effect?: (world: World) => void
}

const say = (lines: ReadonlyArray<string>, exit = 0, every = 0): Play => ({
  steps: lines.map((line, n) => ({ after: n === 0 ? 30 : every, line })),
  exit,
})

const TREES: Record<Repository, Record<string, string[]>> = {
  althar: {
    '': ['AGENTS.md', 'apps', 'brand', 'bun.lock', 'Cargo.toml', 'docs', 'lint', 'node_modules', 'package.json', 'packages', 'README.md'],
    apps: ['cli', 'desktop', 'host', 'report', 'site', 'worker'],
    packages: ['contracts', 'domain', 'runtime', 'testing', 'ui'],
    docs: ['architecture', 'decisions', 'glossary.md', 'plans'],
  },
  'althar-mobile': {
    '': ['app', 'app.json', 'assets', 'bun.lock', 'components', 'ios', 'node_modules', 'package.json', 'README.md', 'tsconfig.json'],
    app: ['(tabs)', '_layout.tsx', 'task'],
    'app/(tabs)': ['_layout.tsx', 'board.tsx', 'index.tsx', 'settings.tsx'],
    components: ['Card.tsx', 'Lane.tsx', 'Mark.tsx'],
    ios: ['AltharMobile', 'AltharMobile.xcodeproj', 'Podfile', 'Podfile.lock'],
  },
}

const columns = (names: ReadonlyArray<string>) => {
  const width = Math.max(...names.map((one) => one.length)) + 2
  const rows: string[] = []
  for (let n = 0; n < names.length; n += 4)
    rows.push(
      names
        .slice(n, n + 4)
        .map((one) => one.padEnd(width))
        .join('')
        .trimEnd(),
    )
  return rows
}

const join = (cwd: string, to: string) => {
  const parts = cwd === '' ? [] : cwd.split('/')
  for (const part of to.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

const statusOf = (shell: Shell, fixed: boolean) => {
  const head = [`On branch ${shell.folder.branch}`, `Your branch is up to date with 'origin/${shell.folder.branch}'.`, '']
  if (!(fixed && shell.folder.repository === 'althar-mobile')) return [...head, 'nothing to commit, working tree clean']
  return [
    ...head,
    'Changes not staged for commit:',
    '  (use "git add <file>..." to update what will be committed)',
    '  (use "git restore <file>..." to discard changes in working directory)',
    '\tmodified:   bun.lock',
    '',
    'no changes added to commit (use "git add" and/or "git commit -a")',
  ]
}

export function interpret(shell: Shell, typed: string, fixed: boolean): Play {
  // What a pipe or a redirect does is past the lab: the command before it answers.
  const command = typed.split(/\s*[|>]\s*/)[0]?.trim() ?? ''
  const [program = '', ...args] = command.split(/\s+/)
  const mobile = shell.folder.repository === 'althar-mobile'
  const where = shell.cwd === '' ? shell.folder.path : `${shell.folder.path}/${shell.cwd}`

  if (command === '') return { steps: [], exit: 0 }
  if (program === 'clear') return { steps: [], exit: 0, clear: true }
  if (program === 'exit') return { steps: [], exit: 0, close: true }
  if (program === 'pwd') return say([where.replace('~', '/Users/balazs')])
  if (program === 'whoami') return say(['balazs'])
  if (program === 'echo') return say([args.join(' ').replace(/^["']|["']$/g, '')])
  if (program === 'node' && args[0] === '-v') return say(['v24.11.0'])
  if (program === 'bun' && args[0] === '-v') return say(['1.3.5'])
  if (program === 'history') return say(shell.history.map((one, n) => `${String(n + 1).padStart(5)}  ${one}`))

  if (program === 'ls') {
    const at = join(shell.cwd, args.find((one) => !one.startsWith('-')) ?? '')
    const names = TREES[shell.folder.repository][at]
    return names === undefined ? say([`ls: ${args.at(-1)}: No such file or directory`], 1) : say(columns(names))
  }

  if (program === 'cd') {
    const to = args[0] ?? ''
    if (to === '' || to === '~') return { steps: [], exit: 0, cwd: '' }
    // To the project's other repository, beside this one.
    const other = /^\.\.\/(althar|althar-mobile)\/?$/.exec(to)?.[1] as Repository | undefined
    if (other !== undefined && shell.cwd === '')
      return {
        steps: [],
        exit: 0,
        cwd: '',
        folder: { ...shell.folder, repository: other, path: shell.folder.path.replace(/[^/]+$/, other) },
      }
    const at = join(shell.cwd, to)
    if (TREES[shell.folder.repository][at] === undefined && at !== '') return say([`cd: no such file or directory: ${to}`], 1)
    return { steps: [], exit: 0, cwd: at }
  }

  if (program === 'git') {
    if (args[0] === 'status') return say(statusOf(shell, fixed))
    if (args[0] === 'diff')
      return fixed && mobile ? say([' bun.lock | 14 +++++++-------', ' 1 file changed, 7 insertions(+), 7 deletions(-)']) : say([])
    if (args[0] === 'log')
      return say(
        mobile
          ? [
              '4be1c09 (HEAD -> main, origin/main) Board cards show their branch',
              'a19f3d2 Bump expo to 54.0.9',
              '77c0e18 Sign in with a paired device',
            ]
          : [
              '138e34a (HEAD -> main, origin/main) Native keyring e2e never pops a keychain dialog locally (#1045)',
              '15a918b Run one recoverable diagnostic on an enrolled Linux worker (#1039)',
            ],
      )
    if (args[0] === 'branch') return say([`* ${shell.folder.branch}`])
    return say([`git: '${args[0] ?? ''}' is not a git command. See 'git --help'.`], 1)
  }

  if ((program === 'bun' || program === 'npm') && (args[0] === 'install' || args[0] === 'i')) {
    if (args.includes('--frozen-lockfile') && mobile && !fixed)
      return say(
        [
          'bun install v1.3.5 (1e86cebd)',
          'Resolving dependencies',
          'Resolved, downloaded and extracted [1148]',
          'error: lockfile had changes, but lockfile is frozen',
          'note: try re-running without --frozen-lockfile and commit the updated lockfile',
        ],
        1,
        260,
      )
    if (!mobile || fixed)
      return say(
        [
          'bun install v1.3.5 (1e86cebd)',
          '',
          `Checked ${mobile ? 1148 : 1204} installs across ${mobile ? 1209 : 1265} packages (no changes) [212.00ms]`,
        ],
        0,
        180,
      )
    return {
      ...say(
        [
          'bun install v1.3.5 (1e86cebd)',
          'Resolving dependencies',
          'Resolved, downloaded and extracted [12]',
          'Saved lockfile',
          '',
          '+ expo-dev-client@6.0.4',
          '+ react-native-reanimated@4.1.2',
          '',
          '1148 packages installed [2.41s]',
        ],
        0,
        280,
      ),
      effect: (world) => world.fix(),
    }
  }

  if (
    (program === 'bun' && args[0] === 'run' && (args[1] === 'check' || args[1] === 'typecheck')) ||
    (program === 'bunx' && args[0] === 'tsc') ||
    program === 'tsc'
  )
    return mobile
      ? say(
          [
            '$ tsc --noEmit',
            "app/(tabs)/board.tsx:48:11 - error TS2322: Type 'string | null' is not assignable to type 'string'.",
            "  Type 'null' is not assignable to type 'string'.",
            '',
            '48     branch={task.branch}',
            '             ~~~~~~',
            '',
            'Found 1 error in app/(tabs)/board.tsx:48',
          ],
          2,
          90,
        )
      : say(
          [
            '$ vp check',
            'Formatted 2,417 files, no changes.',
            'Linted 2,417 files, no problems.',
            'Checked types in 14 packages, no errors.',
          ],
          0,
          400,
        )

  if ((program === 'bunx' && args[0] === 'expo' && args[1] === 'run:ios') || (program === 'bun' && args[1] === 'ios')) {
    if (!mobile) return say(['error: Script not found "ios"'], 1)
    return {
      steps: [
        ...(program === 'bun' ? [{ after: 60, line: '$ expo run:ios' }] : []),
        { after: 300, line: 'env: load .env' },
        { after: 400, line: '› Planning build' },
        { after: 900, line: '› Executing althar-mobile » Bundle React Native code and images' },
        { after: 1100, line: '› Build Succeeded' },
        { after: 500, line: '› Opening on iPhone 17 Pro (dev.althar.mobile)' },
        { after: 300, line: 'Logs for your project will appear below. Press Ctrl+C to exit.' },
      ],
      exit: null,
    }
  }

  if (program === 'cat' && args[0] === 'package.json')
    return say(
      mobile
        ? [
            '{',
            '  "name": "althar-mobile",',
            '  "main": "expo-router/entry",',
            '  "scripts": {',
            '    "ios": "expo run:ios",',
            '    "check": "tsc --noEmit"',
            '  }',
            '}',
          ]
        : ['{', '  "name": "althar",', '  "private": true,', '  "workspaces": ["apps/*", "packages/*"]', '}'],
    )

  return say([`zsh: command not found: ${program}`], 127)
}
