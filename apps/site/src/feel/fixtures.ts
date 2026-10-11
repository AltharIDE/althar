import { Agent } from '../content/agents'

/* Throwaway fixtures for the "feels so good" directions. Made up, but in the person's voice. */

export const LINE = 'Never has building software felt so good.'

export type Step = 'Planning' | 'Implementing' | 'Reviewing' | 'Fixing' | 'Ready'

export interface Task {
  said: string
  title: string
  agent: Agent
  reviewer: Agent
  /** Second the person says it. */
  at: number
  /** Seconds spent in each step, in order; the card is Ready after the last. */
  steps: ReadonlyArray<readonly [Step, number]>
  changes: number
}

const loop = (a: number, b: number, c: number, d: number, e: number): Task['steps'] => [
  ['Planning', a],
  ['Implementing', b],
  ['Reviewing', c],
  ['Fixing', d],
  ['Reviewing', e],
]

/** One afternoon, compressed into about forty seconds. */
export const DAY: readonly Task[] = [
  {
    said: 'the PR card is wrong after a push. fix pls',
    title: 'Fix PR card state after pushing commits',
    agent: Agent.Claude,
    reviewer: Agent.Codex,
    at: 1,
    steps: loop(2, 5, 3, 3, 2),
    changes: 3,
  },
  {
    said: 'running pills: shorten long commands',
    title: 'Shorten long commands in Running pills',
    agent: Agent.Codex,
    reviewer: Agent.Claude,
    at: 4.5,
    steps: loop(1.5, 4, 2.5, 0, 0),
    changes: 2,
  },
  {
    said: 'let the coordinator draft issues. all trackers.',
    title: 'Draft issues on connected trackers',
    agent: Agent.Claude,
    reviewer: Agent.Codex,
    at: 8,
    steps: loop(3, 7, 3, 4, 2.5),
    changes: 5,
  },
  {
    said: 'lightbox should fill big screens',
    title: 'Make the Lightbox fill large screens',
    agent: Agent.Codex,
    reviewer: Agent.Claude,
    at: 13,
    steps: loop(1, 3, 2, 0, 0),
    changes: 1,
  },
  {
    said: 'page jumps after I answer a question. why',
    title: 'Stop the page jumping after an answer',
    agent: Agent.Claude,
    reviewer: Agent.Codex,
    at: 17,
    steps: loop(2.5, 4, 3, 2, 2),
    changes: 3,
  },
]

export const DAY_END = 36

export const startOf = (task: Task) => task.at + 1.2

export const doneAt = (task: Task) => startOf(task) + task.steps.reduce((sum, [, s]) => sum + s, 0)

/** Where a task is at second t: null before it's said. */
export function stateAt(task: Task, t: number): { step: Step | 'Said'; progress: number } | null {
  if (t < task.at) return null
  if (t < startOf(task)) return { step: 'Said', progress: 0 }
  let clock = startOf(task)
  const total = doneAt(task) - startOf(task)
  for (const [step, s] of task.steps) {
    if (s > 0 && t < clock + s) return { step, progress: (t - startOf(task)) / total }
    clock += s
  }
  return { step: 'Ready', progress: 1 }
}

/** The quiet thread: what scrolls under the one line, forever. */
export type Beat =
  | { kind: 'you'; text: string }
  | { kind: 'althar'; text: string }
  | { kind: 'card'; title: string; agent: Agent; step: Step; note: string }

export const THREAD: readonly Beat[] = [
  { kind: 'you', text: 'approval card. all trackers.' },
  { kind: 'althar', text: 'On it. Claude leads, Codex reviews. Linear, Jira and GitHub Issues.' },
  { kind: 'card', title: 'Approval card for every tracker', agent: Agent.Claude, step: 'Implementing', note: '4 files · 2 min' },
  { kind: 'you', text: 'yes, do the setup path' },
  { kind: 'card', title: 'Guided setup for code hosts', agent: Agent.Codex, step: 'Reviewing', note: 'Claude found 2 things' },
  { kind: 'althar', text: 'Review came back clean on the second pass. Ready when you are.' },
  { kind: 'you', text: 'push pls' },
  { kind: 'card', title: 'Fix PR card state after pushing', agent: Agent.Claude, step: 'Ready', note: 'PR #107 opened' },
  { kind: 'you', text: 'mic picker in settings? the airpods keep winning' },
  { kind: 'althar', text: 'Started a mini task. One lead, no review.' },
  { kind: 'card', title: 'Choose the microphone for dictation', agent: Agent.Codex, step: 'Ready', note: 'PR #103 opened' },
  { kind: 'you', text: 'nice. ship it' },
]

/** Building Althar with Althar: what was said, and the PR it became. */
export const WORDS: ReadonlyArray<{ said: string; pr: number; title: string }> = [
  { said: 'the page jumps after I answer. kill it', pr: 119, title: 'Stop the page jumping after answering a question' },
  { said: 'lightbox on a big screen looks like a stamp', pr: 118, title: 'Make the Lightbox fill large screens' },
  { said: 'let leads listen on localhost, sandbox is blocking it', pr: 112, title: 'Let leads listen on localhost inside the sandbox' },
  { said: 'running pills: the commands are a paragraph', pr: 109, title: 'Shorten long commands in Running pills' },
  { said: 'coordinator should draft issues. all trackers.', pr: 108, title: 'Let the coordinator draft issues on connected trackers' },
  { said: 'PR card lies after a push', pr: 107, title: 'Fix PR card state after pushing commits' },
  { said: 'let me pick the mic. airpods keep winning', pr: 103, title: 'Choose the microphone used for dictation' },
  { said: 'sign it, notarize it, make it update itself', pr: 95, title: 'Althar is signed, notarized and updates itself' },
]

export const PR = (n: number) => `https://github.com/AltharIDE/althar/pull/${n}`
