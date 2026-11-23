import { fn } from 'storybook/test'

import type { RoadmapItem } from '../screens/ComingNext/ComingNext'
import { HostAndWorkers } from '../screens/WhatsNew/HostAndWorkers'
import type { ReleaseNotes } from '../screens/WhatsNew/notes'
import type { FollowLink, WhatsNewFeature, WhatsNewLead } from '../screens/WhatsNew/WhatsNew'

/* Althar's own page after an update, as the stories and tests show it: a few releases' notes, shortened, and the roadmap. */

export const RELEASE_0_10: ReleaseNotes = {
  version: '0.10.0',
  date: '2026-11-20',
  title: 'Althar on your own machines',
  changes: [
    {
      kind: 'new',
      text: 'Your own host: run Althar on a Linux server of yours, x64 or arm64, as a home for your projects. Their tasks and agents live there, and keep working when you close the window.',
    },
    {
      kind: 'new',
      text: 'Computer use: a task’s lead uses the apps on your computer, with one ask a turn. Its card shows what it’s doing and its latest screenshot.',
    },
    {
      kind: 'new',
      text: 'Goals: give a task’s lead a `/goal`, and it keeps working toward it turn after turn, until it’s met, blocked or you pause it.',
    },
    { kind: 'improved', text: 'Althar answers at once, however busy your computer is: the model picker, search and the board included.' },
    { kind: 'improved', text: 'Long threads open and scroll smoothly, at any length.' },
    { kind: 'fixed', text: 'A dev server’s private window keeps its sign-in across a restart.' },
  ],
}

export const RELEASE_0_9: ReleaseNotes = {
  version: '0.9.0',
  date: '2026-11-15',
  title: 'Take back a turn',
  changes: [
    {
      kind: 'new',
      text: 'Undo from here, in a task with its own worktree: a message and the replies after it leave, the files they changed go back.',
    },
    { kind: 'improved', text: 'A message sent mid-turn shows in the queue at once.' },
    { kind: 'fixed', text: 'Turning crash reports off stops the reports still waiting to be sent.' },
  ],
}

export const RELEASE_0_8: ReleaseNotes = {
  version: '0.8.0',
  date: '2026-11-13',
  title: 'Your app, beside the conversation',
  changes: [{ kind: 'new', text: 'A browser, built in: your task’s app opens beside the conversation.' }],
}

export const RELEASES = [RELEASE_0_10, RELEASE_0_9, RELEASE_0_8] as const

export const LEAD: WhatsNewLead = {
  title: 'Your own host, your own workers',
  why: 'Run Althar on a server of yours, and your own machines as its workers. Close the laptop, and the work goes on.',
  picture: { title: 'Where the work runs now', drawing: <HostAndWorkers /> },
}

export const FEATURES: readonly WhatsNewFeature[] = [
  {
    name: 'Computer use',
    line: 'A task’s lead uses the apps on your computer, with one ask a turn.',
    whole: 'A task’s lead uses the apps on your computer, with one ask a turn. Its card shows what it’s doing and its latest screenshot.',
    icon: 'viewport',
    art: 'computer-use',
  },
  {
    name: 'Artifacts you talk to',
    line: 'Open one beside its own chat, point at a part and say what you think, and its agent draws a new version.',
    whole: 'Open one beside its own chat, point at a part and say what you think, and its agent draws a new version.',
    icon: 'canvas',
    art: 'artifacts',
  },
  { name: 'Goals', line: 'Give a task’s lead a `/goal`.', whole: 'Give a task’s lead a `/goal`.', icon: 'pin', art: 'goals' },
  {
    name: 'More agents',
    line: 'Connect any coding agent from the ACP registry.',
    whole: 'Connect any coding agent from the ACP registry.',
    icon: 'agents',
    art: 'agents',
    way: { label: 'Add an agent', onPress: fn() },
  },
  { name: 'Terminals in Althar', line: 'Runs and terminals along the window’s foot.', whole: '', icon: 'terminal', art: 'terminals' },
  { name: 'Bring in your work', line: 'Bring in work from Conductor, Orca and Cursor.', whole: '', icon: 'download', art: 'bring-in' },
]

export const BETTER = [
  'Althar answers at once, however busy your computer is.',
  'Idle coordinators rest after half an hour and wake on your message.',
  'A full session compacts in place and carries on.',
  'Long threads open and scroll smoothly, at any length.',
] as const

export const FOLLOW: readonly FollowLink[] = [
  { kind: 'github', href: 'https://github.com/AltharIDE/althar', handle: 'AltharIDE/althar' },
  { kind: 'discord', href: 'https://discord.gg/QA2g8MwKda', handle: 'Althar’s server' },
  { kind: 'x', href: 'https://x.com/AltharAiUS', handle: '@AltharAiUS' },
  { kind: 'linkedin', href: 'https://www.linkedin.com/company/althar-ai/', handle: 'althar-ai' },
]

const say = (title: string) => `https://github.com/AltharIDE/althar/issues/new?title=${encodeURIComponent(`${title}: `)}`

export const ROADMAP: readonly RoadmapItem[] = [
  {
    stage: 'now',
    title: 'Mobile app',
    detail: 'Pair your phone with your home and follow every task from it.',
    picture: 'phone',
    say: say('Mobile app'),
  },
  {
    stage: 'next',
    title: 'Event-based automations',
    detail: 'Automations that start when something happens: main going red, a check that keeps failing.',
    picture: 'trigger',
    say: say('Event-based automations'),
  },
  {
    stage: 'next',
    title: 'Integrated simulators',
    detail: 'iOS simulators beside the task.',
    picture: 'simulator',
    say: say('Integrated simulators'),
  },
  {
    stage: 'next',
    title: 'Project knowledge store',
    detail: 'What a project has learned, kept.',
    picture: 'knowledge',
    say: say('Project knowledge store'),
  },
  { stage: 'later', title: 'Windows signing', detail: 'A signed installer.', picture: 'installer', say: say('Windows signing') },
  { stage: 'later', title: 'Teams, in the cloud', detail: 'Shared projects.', picture: 'team', say: say('Teams, in the cloud') },
]
