// Scrappy: what each path says, in one place to compare them.
import type { RuleKind } from '@althar/contracts'

import type { Mode } from './store'

const KIND: Record<RuleKind, string> = {
  'default-branch': 'pushing to the default branch',
  'force-push': 'force pushing',
  'many-branches': 'pushing several branches or tags',
  'delete-branch': 'deleting other branches',
  deploy: 'deploying and publishing',
  outside: 'writing outside the task’s worktree',
}

/** The four modes, as the Rules page and a new project name them (RulesView's words). */
export const MODES: Record<Mode, { readonly title: string; readonly note: string; readonly short: string }> = {
  rules: {
    title: 'Allow, except what you keep',
    short: 'Allow, except…',
    note: 'Agents carry on without stopping. What “Always ask me” lists waits for you; what “Never” lists is refused.',
  },
  coordinator: {
    title: 'The coordinator decides',
    short: 'Coordinator decides',
    note: 'The coordinator allows or denies requests within the project’s rules, with a reason. Anything it can’t decide waits for you.',
  },
  ask: {
    title: 'Ask me',
    short: 'Ask me',
    note: 'What agents ask to do beyond the task’s own files waits for you.',
  },
  allow: {
    title: 'Allow everything',
    short: 'Allow everything',
    note: 'Nothing waits for you. What “Never” lists is still refused, and, while it lists anything, a command Althar can’t read.',
  },
}

export const MODE_ORDER: ReadonlyArray<Mode> = ['rules', 'coordinator', 'ask', 'allow']

export const words = {
  /** What no mode changes, said where allow everything is turned on. */
  holds: 'Never still holds, and no lead reads your credentials or reaches the code host except through Althar.',
  /** The same on the Rules page, where Always says the rest just under it. */
  holdsBelow: 'What Never lists below is still refused.',
  /** Why a card has no "always allow", where its kind always asks. */
  noAlways: (kind: RuleKind, project: string) => `No “always allow”: ${project} always asks you before ${KIND[kind]}.`,
  rules: 'Change it in Rules',
  /** The waiting prompts, once allow everything came on: how many went ahead, and how many went back to be spelled out. */
  allowedWaiting: (n: number) => (n === 1 ? 'Allowed the 1 waiting' : `Allowed ${n} waiting`),
  sentBack: (n: number) => `Althar can’t read ${n === 1 ? 'it' : 'them'} while meridian’s Never list names something`,
  /** What went ahead after, with no one asked. */
  after: (n: number) => (n === 1 ? 'Allowed 1 request' : `Allowed ${n} requests`),

  A: {
    switch: 'Allow everything',
    switchNote: (project: string, back: string) =>
      `Nothing in ${project} waits for you. Off, it goes back to ${back}. What Never lists below is still refused.`,
    task: 'Allow everything on this task',
    taskNote: 'Nothing on this task waits for you. Never still holds.',
    badge: 'Unrestricted',
    badgeTip: (project: boolean) => (project ? 'meridian allows everything: nothing waits for you' : 'Nothing on this task waits for you'),
    wayOut: 'Allow everything on this task',
    cleared: 'Allow everything is on for this task',
    by: 'by Allow everything on this task',
  },

  B: {
    rulesLabel: 'What waits for you',
    chip: (own: boolean, mode: Mode) => (own ? `This task · ${MODES[mode].title}` : `Project default · ${MODES[mode].title}`),
    menu: 'Permissions on this task',
    group: 'This task',
    back: 'Back to project default',
    backNote: (mode: Mode) => `meridian: ${MODES[mode].title}`,
    wayOut: 'Change this task’s permissions',
    cleared: 'This task allows everything now',
    by: 'by Allow everything on this task',
  },

  C: {
    option: 'Yes, and stop asking on this task',
    under: (waiting: number) =>
      `Allows this${waiting > 1 ? ` and the ${waiting - 1} waiting` : ''}, and what the task asks next, until it’s done. Never still holds, and no lead reads your credentials or reaches the code host.`,
    button: 'Allow and stop asking',
    alsoHere: 'Stopping asking on this task lets it through.',
    badge: 'Not asking on this task',
    badgeTip: 'Undo from the thread, or ask again from the task’s menu',
    askAgain: 'Ask me again on this task',
    askAgainNote: 'What it asks next waits for you, as meridian’s rules say.',
    cleared: 'Stopped asking on this task',
    undo: 'Ask again',
    by: 'by not asking on this task',
  },

  D: {
    option: 'Yes, and allow everything on this task',
    until: { hour: 'for 1 hour', task: 'until it’s ready', off: 'until I turn it off' } satisfies Record<'hour' | 'task' | 'off', string>,
    menu: 'Allow everything on this task',
    menuOff: 'Off',
    menuOffNote: 'What meridian’s rules keep for you waits for you.',
    menuItem: { hour: 'For 1 hour', task: 'Until it’s ready', off: 'Until I turn it off' } satisfies Record<
      'hour' | 'task' | 'off',
      string
    >,
    menuNote: {
      hour: 'Then it asks again, by itself.',
      task: 'Ends once its work is ready for you.',
      off: 'Stays on until you turn it off here or from the pill.',
    } satisfies Record<'hour' | 'task' | 'off', string>,
    button: 'Allow everything',
    alsoHere: 'Allowing everything on this task for a while lets it through.',
    pill: 'Allowing everything',
    left: (minutes: number) => `${minutes}m left`,
    pillTask: 'until it’s ready',
    pillOff: 'until you turn it off',
    popTitle: 'Allow everything on this task',
    /** How it ends, in the pill's list: when, then what comes after. */
    ends: (clock: string) => ({ title: `Until ${clock}`, then: 'Then it asks as meridian’s rules say. Never still holds.' }),
    endsTask: { title: 'Until its work is ready', then: 'Then it asks as meridian’s rules say. Never still holds.' },
    endsOff: { title: 'Until you turn it off', then: 'Never still holds, and no lead reads your credentials.' },
    turnOff: 'Turn off now',
    more: 'One more hour',
    asking: 'Asking again',
    ended: (clock: string) => `ended ${clock}`,
    endedLine: (clock: string, n: number) => `Allow everything ended at ${clock} · ${n} requests went ahead while it was on`,
    show: 'Show',
    project: 'Allow everything in meridian',
    projectOff: 'Off: what the rules below keep for you waits for you.',
    projectOn: (clock: string | null, back: string) =>
      clock === null ? `On until you turn it off. Then back to ${back}.` : `On until ${clock}. Then back to ${back}.`,
    projectChoices: { none: 'Off', hour: 'For 1 hour', off: 'Until I turn it off' } satisfies Record<'none' | 'hour' | 'off', string>,
    badge: (minutes: number | null, until: 'hour' | 'task' | 'off') =>
      until === 'hour' && minutes !== null
        ? `Allowing everything · ${minutes}m`
        : until === 'task'
          ? 'Allowing everything · until ready'
          : 'Allowing everything',
    by: 'by Allow everything, for a while',
  },

  BC: {
    option: 'Yes, and allow everything on this task',
    under: (waiting: number) =>
      `Allows this${waiting > 1 ? ` and the ${waiting - 1} waiting` : ''}, and what the task asks next. The chip at the top says so, and takes it back. Never still holds, and no lead reads your credentials or reaches the code host.`,
    button: 'Allow everything here',
    alsoHere: 'Allowing everything on this task lets it through.',
    cleared: 'This task allows everything now',
    undo: 'Back to project default',
  },
}
