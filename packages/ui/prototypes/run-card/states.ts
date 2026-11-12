/*
 * The run in each state the card draws, as the runtime would give it: what
 * the project keeps it as, its command, where it answers, how it ended and
 * its last lines. `place` is the thread it's drawn in: a task's, under a
 * header that already names the task, or the project's conversation, where
 * the task it runs for is worth saying.
 */

export type Phase = 'starting' | 'up' | 'failed' | 'finished' | 'stopped'

export interface RunState {
  key: string
  label: string
  phase: Phase
  /** What the project keeps it as, in its Run list. Without it, the command is all there is to call it. */
  name?: string
  command: string
  /** The task it runs for, or the default branch. */
  where: string
  place: 'task' | 'project'
  /** Where it answers, once it says. */
  url?: string
  /** How long it has run, or when it ended. */
  since: string
  /** When it started, as a clock says it. */
  started: string
  /** Its exit code, once it ended by itself. */
  code?: number | null
  /** The last lines it printed, oldest first. */
  lines?: readonly string[]
  /** Which of them says why, as the runtime picks it today (`endingLine`). */
  why?: number
}

const NAME = 'Small change card prototype'
const COMMAND = 'cd packages/ui && ../../node_modules/.bin/vp dev --config prototypes/small-change/vite.config.mjs'
const TASK = 'Prototype: the small change card, a few designs'

const base = { name: NAME, command: COMMAND, where: TASK, place: 'task', started: '2:41 pm' } as const

const READY = ['VITE v7.1.3  ready in 412 ms', '➜  Local:   http://localhost:6143/', '➜  Network: use --host to expose']

export const STATES: readonly RunState[] = [
  {
    ...base,
    key: 'starting',
    label: 'Starting',
    phase: 'starting',
    since: '4s',
    lines: ['$ vp dev --config prototypes/small-change/vite.config.mjs'],
  },
  { ...base, key: 'up', label: 'Running', phase: 'up', url: 'localhost:6143', since: '11s', lines: READY },
  {
    ...base,
    key: 'failed',
    label: 'Failed',
    phase: 'failed',
    since: '2m ago',
    code: 1,
    lines: [
      'error when starting dev server:',
      'Error: Port 6143 is already in use',
      '    at Server.onError (node_modules/vite/dist/node/chunks/dep-C6qYk3zB.js:45596:18)',
    ],
    why: 1,
  },
  {
    key: 'finished',
    label: 'Finished by itself',
    phase: 'finished',
    name: 'Build the site',
    command: 'cd apps/site && bun run build',
    where: TASK,
    place: 'task',
    started: '2:38 pm',
    since: '1m ago',
    code: 0,
    lines: ['dist/assets/index-4f1c.js   212.40 kB │ gzip: 68.11 kB', '✓ built in 2.41s'],
    why: 1,
  },
  { ...base, key: 'stopped', label: 'Stopped', phase: 'stopped', since: '4m ago', code: null },
  {
    ...base,
    key: 'project',
    label: 'In the project’s conversation',
    place: 'project',
    phase: 'up',
    url: 'localhost:6143',
    since: '11s',
    lines: READY,
  },
  {
    key: 'unnamed',
    label: 'No name, a long command',
    phase: 'up',
    command: 'cd apps/desktop && ALTHAR_PROFILE="$(mktemp -d -t althar-fresh)" bun run dev --inspect --remote-debugging-port=9222',
    where: TASK,
    place: 'task',
    started: '2:44 pm',
    url: 'localhost:5173',
    since: '2m',
    lines: ['[main] ready in 1.8s', '➜  Local:   http://localhost:5173/'],
  },
]

/** The line that says why, else the last. */
export const whyOf = (s: RunState): string | undefined => (s.lines === undefined ? undefined : s.lines[s.why ?? s.lines.length - 1])

/** Is it over? */
export const isEnded = (s: RunState) => s.phase === 'failed' || s.phase === 'finished' || s.phase === 'stopped'
