/*
 * What changed in Althar, release by release, from the release notes on
 * GitHub; what has merged on main since the last release; and what's next,
 * from the plans in docs/plans. Each line in the releases' own words, except
 * that the site shows no ⌘-only shortcuts and no internal labels.
 */

export type Kind = 'new' | 'improved' | 'fixed'

export const KIND_WORD: Record<Kind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' }

export interface Change {
  kind: Kind
  /** One line; `code` in backticks. */
  text: string
}

export interface Release {
  version: string
  /** ISO date it was published. */
  date: string
  /** What the release is about, in a few words. */
  title: string
  changes: readonly Change[]
}

const REPO = 'https://github.com/AltharIDE/althar'
export const releaseUrl = (version: string) => `${REPO}/releases/tag/v${version}`
export const pullUrl = (no: number) => `${REPO}/pull/${no}`

/** The releases, newest first. */
export const RELEASES: readonly Release[] = [
  {
    version: '0.5.0',
    date: '2026-10-20',
    title: 'Windows, and seven more agents',
    changes: [
      {
        kind: 'new',
        text: 'Althar on Windows: an installer for x64 that installs for you alone, with no administrator’s prompt, and updates itself. It isn’t signed yet, so SmartScreen warns the first time: More info, then Run anyway.',
      },
      {
        kind: 'new',
        text: 'Seven more agents: GitHub Copilot, Junie, Grok Build, Kimi Code, Mistral Vibe, Qwen Code and Google Antigravity. Each one joins only where Althar can keep it asking before it acts.',
      },
      {
        kind: 'new',
        text: 'Attach a task to a pull request it didn’t open, by its link or number. The task then follows it as its own: reviews, comments, checks and conflicts reach it.',
      },
      {
        kind: 'new',
        text: 'A task’s lead can draft issues on your trackers. Each draft is a card in the task’s thread, to file, edit or throw away.',
      },
      { kind: 'new', text: 'Up next lists every task waiting for a free agent, with its place in line. Drag a row to change the order.' },
      { kind: 'new', text: 'Drag a project’s tab along the bar to reorder your open projects.' },
      {
        kind: 'new',
        text: 'A project’s settings are a page of the project, beside its board: General, Code and issues, Rules, Running and Notes.',
      },
      {
        kind: 'improved',
        text: 'A finished quick task, prototype or review waits in Needs you until you choose Done or Keep for later, instead of settling itself the moment you open it.',
      },
      {
        kind: 'improved',
        text: 'When an agent runs out of usage, the card and the thread say which agent, on which step, until when, and what Althar is doing about it.',
      },
      {
        kind: 'improved',
        text: 'A task’s Outputs page is two columns: what the task is on the left, the change on the right, with its checks, its review and the one action that fits.',
      },
      {
        kind: 'improved',
        text: 'When the board is too narrow for its four lanes, they fold to slim rails instead of running off the side.',
      },
      { kind: 'improved', text: 'When you dictate a message, the agent is told, so a misheard name is read generously.' },
      {
        kind: 'fixed',
        text: 'A redirect before a command, as in `> /dev/null git push --force`, no longer gets it past asking.',
      },
      {
        kind: 'fixed',
        text: 'After a long shutdown, a task whose lead was working carries on by itself, instead of going stuck seconds after the next launch.',
      },
      { kind: 'fixed', text: 'A failed check’s log on GitHub can be read again: the card shows it and the lead gets it.' },
      { kind: 'fixed', text: 'In a Linux Flatpak, sign-ins are kept across restarts.' },
      { kind: 'fixed', text: 'When a step’s agent can’t start, the step says why.' },
    ],
  },
  {
    version: '0.4.1',
    date: '2026-10-18',
    title: 'Crash reports, and pull requests written for a reviewer',
    changes: [
      {
        kind: 'new',
        text: 'Crash reports: when something in Althar fails, it can tell us without you writing in, with folders, names, email addresses and keys taken out, and never your prompts, messages or files. Turn them off on the first screen or in Settings.',
      },
      { kind: 'new', text: 'On Linux, Althar’s tray mark is light on dark panels, and has a menu.' },
      {
        kind: 'improved',
        text: 'A pull request Althar opens has a description its lead writes for a reviewer: why, what changed and how it was checked, in the repository’s template where it has one.',
      },
      { kind: 'fixed', text: 'An agent Althar couldn’t check no longer hides the others. It says so on its own row, with Check again.' },
      {
        kind: 'fixed',
        text: 'An agent that never answers stops after two minutes and says it couldn’t start, instead of waiting for ever.',
      },
      { kind: 'fixed', text: 'Enter no longer answers a permission card; only a click does.' },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-18',
    title: 'Tell us what broke, from anywhere',
    changes: [
      {
        kind: 'new',
        text: 'Report a problem, from the app’s menu, quick settings or a stuck step. It sends what you write, with a screenshot and Althar’s logs, with folders, names and keys taken out.',
      },
      { kind: 'new', text: 'Dictation keeps going when you leave its screen. A pill says who the message is for.' },
      { kind: 'new', text: 'Push and merge from a board card, without opening the task.' },
      { kind: 'new', text: 'Tasks waiting for a free agent are listed in Up next, in the order they will start.' },
      { kind: 'improved', text: 'Between sending and the first word, Thinking shows where the reply will start.' },
      { kind: 'improved', text: 'Stuck cards say in plain words what happened and which button to press.' },
      { kind: 'improved', text: 'The composer’s foot stays on one row, and nothing is cut off in a narrow window.' },
      {
        kind: 'fixed',
        text: 'Abandoning a task closes its pull request on GitHub, GitLab or Bitbucket, and its branch, instead of only saying so.',
      },
      { kind: 'fixed', text: 'The home and the board agree on what needs you.' },
      { kind: 'fixed', text: 'A local merge no longer fails on a submodule it doesn’t move.' },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-16',
    title: 'Run many things, allow everything',
    changes: [
      {
        kind: 'new',
        text: 'A project can run many things, not one. The Run button is split: a press runs the first, and its list starts or stops any of them.',
      },
      {
        kind: 'new',
        text: 'Allow everything with one switch, for a project in Rules or for a single task from its menu. Never still holds.',
      },
      { kind: 'new', text: 'The coordinator can find and list pull requests, and start a review of someone else’s.' },
      { kind: 'new', text: 'Find any task, in a project or across all of them, from the keyboard.' },
      { kind: 'new', text: 'A finished task can go back to work and ship again, as a further pull request.' },
      {
        kind: 'improved',
        text: 'A task’s thread reads in rounds: your ask, its lead’s first word, its work in one line you can open, and its result.',
      },
      { kind: 'improved', text: 'A ready change says what stands in the way of merging, and the next thing to do.' },
      { kind: 'improved', text: 'Failed checks are run again once and read in full before the lead is told.' },
      { kind: 'improved', text: 'What you’ve written in a composer, and dictation, is kept when you go to another screen.' },
      { kind: 'fixed', text: 'A failed command keeps what it printed.' },
      { kind: 'fixed', text: 'Ordinary edits to one file are no longer stopped as a loop.' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-13',
    title: 'Tasks that show their evidence',
    changes: [
      {
        kind: 'new',
        text: 'A finished task ends with what it built, the evidence its lead showed (screenshots, test runs and what they printed) and anything it couldn’t check. The reviewer reads the evidence too.',
      },
      { kind: 'new', text: 'Set how many agents run at once. Past that, tasks wait for a free place.' },
      { kind: 'new', text: 'Rename a task from its header or its menu.' },
      { kind: 'improved', text: 'On Linear and Jira, a task’s issue moves to In Progress when the task starts.' },
      {
        kind: 'improved',
        text: 'The coordinator hands over to a fresh session before its context fills, so a long-running project keeps its thread.',
      },
      {
        kind: 'improved',
        text: 'A task whose branch drifted from its pull request offers to bring the two together, instead of failing the push.',
      },
      { kind: 'fixed', text: 'Push sends every commit, and the count clears.' },
      { kind: 'fixed', text: 'A conflict round no longer fails while the lead is still working.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-12',
    title: 'The first build',
    changes: [
      {
        kind: 'new',
        text: 'Open a folder as a project and tell its coordinator what you want changed. It plans tasks, each with a lead that implements it and a review.',
      },
      { kind: 'new', text: 'Claude Code, Codex and OpenCode, with the accounts you already signed in with.' },
      { kind: 'new', text: 'The home shows what needs you across every project.' },
      { kind: 'new', text: 'Dictation runs on your computer, after a one-time download of the speech model.' },
      { kind: 'new', text: 'Althar updates itself, never while work runs.' },
    ],
  },
]

export interface Merged {
  date: string
  text: string
  pr: number
}

/** Merged on main since the last release, newest first: what the next one will carry. */
export const ON_MAIN: readonly Merged[] = [
  { date: '2026-10-30', text: 'A calm view of a branch with no pull request', pr: 405 },
  { date: '2026-10-30', text: 'Merge through GitHub’s merge queue, and see a pull request waiting in it', pr: 395 },
  { date: '2026-10-29', text: 'Pull request reviews start from a plan you can change', pr: 385 },
  { date: '2026-10-29', text: 'Failing checks go back to the lead, even after you’ve looked', pr: 388 },
  { date: '2026-10-29', text: 'Every error offers its way out, starting with sign-in', pr: 380 },
  { date: '2026-10-29', text: 'One motion system across the app', pr: 390 },
  { date: '2026-10-29', text: 'Settling a task stops everything it left running', pr: 386 },
  { date: '2026-10-28', text: 'Run any branch or pull request', pr: 358 },
  { date: '2026-10-28', text: 'Allow everything asks only before what can’t be undone', pr: 378 },
  { date: '2026-10-28', text: 'Leads can show pictures in the thread at any time', pr: 372 },
  { date: '2026-10-28', text: 'Home opens instantly, as project tabs do', pr: 371 },
  { date: '2026-10-27', text: 'Plan usage: every agent’s window, and work steered by it', pr: 324 },
  { date: '2026-10-27', text: 'Automations: work that starts itself, on a schedule', pr: 339 },
]

export type Stage = 'now' | 'next' | 'later'

export const STAGE_WORD: Record<Stage, string> = { now: 'Now', next: 'Next', later: 'Later' }

export interface Planned {
  stage: Stage
  title: string
  detail: string
}

/** What's next: a draft until it's agreed. */
export const ROADMAP: readonly Planned[] = [
  {
    stage: 'now',
    title: 'Windows signing',
    detail: 'A signed installer, so Windows stops warning you the first time you open Althar.',
  },
  {
    stage: 'now',
    title: 'Event-based automations',
    detail:
      'Automations that start when something happens, not only at a time of day: a pull request opened, an issue filed, a check failing on main.',
  },
  {
    stage: 'next',
    title: 'Mobile app',
    detail:
      'See what needs you and answer it from your phone: allow a command, read a finished change, merge it. The work keeps running on your computer.',
  },
  {
    stage: 'next',
    title: 'Integrated browser',
    detail:
      'A browser inside Althar. A lead opens the page it changed, clicks through it and shows you what it saw, and you check it without leaving the task.',
  },
  {
    stage: 'next',
    title: 'Integrated simulators',
    detail: 'Phone simulators beside the task. A lead runs the app it changed, tries the flow and brings back what it saw.',
  },
  {
    stage: 'later',
    title: 'Project knowledge store',
    detail:
      'What a project has learned, kept: its decisions, conventions and notes, each with where it came from. Every agent starts from it, whichever one you use next.',
  },
  {
    stage: 'later',
    title: 'Teams, in the cloud',
    detail: 'Shared projects and hosted agents, for a team working on the same code.',
  },
]
