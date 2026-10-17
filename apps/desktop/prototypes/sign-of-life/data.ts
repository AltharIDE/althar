// Scrappy: the two conversations the page shows (the coordinator's, and a task's), what the person sends in each, and how the lead answers.
import type { ProjectSummary, ThreadItem } from '@althar/contracts'

import { items, project } from '../../tests/fixtures'

export const ROOT = '/Users/balazs/Charrette/althar'

export const althar: ProjectSummary = { ...project, id: 'p1', name: 'althar' }

export const COORDINATOR = 'thc'
export const TASK_THREAD = 'th_dict'
export const TASK_ID = 't_dict'

export type Screen = 'coordinator' | 'task'

export const SCREENS: ReadonlyArray<{ readonly value: Screen; readonly label: string }> = [
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'task', label: 'Task' },
]

export const threadOfScreen = (screen: Screen) => (screen === 'coordinator' ? COORDINATOR : TASK_THREAD)
export const screenOfThread = (threadId: string | null): Screen | null =>
  threadId === COORDINATOR ? 'coordinator' : threadId === TASK_THREAD ? 'task' : null

export const TASK_TITLE = 'Let a long dictation scroll in the composer'

let made = 0
/** An item, at a moment, after every one before it. */
export const at = (item: ThreadItem, when: number, id?: string): ThreadItem => {
  made += 1
  return { ...item, id: id ?? `x${made}`, sequence: made, createdAt: new Date(when).toISOString() } as ThreadItem
}

const MINUTE = 60_000

const tool = (title: string, toolKind: string, extra: Record<string, unknown> = {}) =>
  items.tool({ title, toolKind, status: 'completed', ...extra } as Parameters<typeof items.tool>[0])

/** What was said before: the coordinator's conversation, an exchange old. */
export const coordinatorBefore = (now: number): ReadonlyArray<ThreadItem> => [
  at(items.you('What’s left before the dictation work can ship?'), now - 14 * MINUTE),
  at(tool('Read the board', 'read'), now - 14 * MINUTE + 4000),
  at(tool('Read Keep composer text and dictation when navigating', 'read'), now - 14 * MINUTE + 7000),
  at(
    items.says(
      'Two tasks are still open. **Keep composer text and dictation when navigating** is in review, with one finding left to settle. **Let a long dictation scroll in the composer** finished an hour ago and waits for you to look at it. Nothing else touches dictation.',
    ),
    now - 14 * MINUTE + 12_000,
  ),
]

/** What was said before: a task's first round, finished. */
export const taskBefore = (now: number): ReadonlyArray<ThreadItem> => [
  at(
    items.you('Let a long dictation scroll in the composer, instead of growing the field past the window.', {
      state: 'delivered',
      interrupting: false,
    }),
    now - 52 * MINUTE,
  ),
  at(
    items.says(
      'I’ll cap the composer’s height at 40% of the window and let the field scroll past that, so a long dictation never pushes the thread away.',
    ),
    now - 52 * MINUTE + 9000,
  ),
  at(tool('Read Composer.tsx', 'read'), now - 52 * MINUTE + 14_000),
  at(tool('Edit Composer.module.css', 'edit'), now - 51 * MINUTE),
  at(tool('Edit useAutosize.ts', 'edit'), now - 50 * MINUTE),
  at(tool('Run the composer’s tests', 'execute', { command: 'bunx vp test run composer --maxWorkers=1' }), now - 48 * MINUTE),
  at(
    items.says(
      'Done: the field stops growing at 40% of the window and scrolls inside from there; the send row stays put. Checked in the composer’s story with a dictation of 900 words.',
    ),
    now - 46 * MINUTE,
  ),
]

/** What the person sends from the bar. */
export const SAID: Readonly<Record<Screen, string>> = {
  coordinator: 'Which of the tasks running now touch the composer?',
  task: 'Can you also keep the caret in view while it scrolls?',
}

/** What the lead was on when the person sent, where the bar says it was busy. */
export const BUSY: Readonly<Record<Screen, { readonly ask: string; readonly tool: string; readonly done: string }>> = {
  coordinator: {
    ask: 'Is anything stuck on the board?',
    tool: 'Read the board',
    done: 'Nothing is stuck: every task under way did something in the last ten minutes.',
  },
  task: {
    ask: 'Run the whole UI suite once more before I look.',
    tool: 'Run the UI tests',
    done: 'The UI suite passes: 412 tests, none skipped.',
  },
}

/** How the lead answers: what it says first, the steps of its work, and what it says last. The coordinator only says. */
export const REPLY: Readonly<
  Record<Screen, { readonly first: string; readonly steps: ReadonlyArray<string>; readonly last: string | null }>
> = {
  coordinator: {
    first:
      'Two of them do. **Keep composer text and dictation when navigating** changes how a draft is kept as you move between screens, and **Let a long dictation scroll in the composer** changes how tall the field grows. They change different parts of `Composer.tsx`, so they shouldn’t get in each other’s way; whichever merges second merges main in first.',
    steps: [],
    last: null,
  },
  task: {
    first:
      'Yes: I’ll keep the caret in view as dictation adds words, scrolling the field to it after each one lands, unless you’ve scrolled up yourself.',
    steps: ['Read useAutosize.ts', 'Edit useAutosize.ts', 'Run the composer’s tests'],
    last: 'Done: the field follows the caret while dictation writes, and stops following once you scroll up, until you scroll back down.',
  },
}

/** Why Fails fails: what the agent said as it gave up. */
export const FAILURE = 'API Error: 529 Overloaded. Tried 10 times over 45 seconds.'
