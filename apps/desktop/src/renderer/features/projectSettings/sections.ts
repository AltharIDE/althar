import type { IconName } from '@althar/ui'

/*
 * A project's settings, by what each is about, as its Settings view lists
 * them down its side and its address names them: what it is and how its
 * tasks work, and what its code and issues are; what its agents may do,
 * and what it runs; then what its coordinator keeps. A setting to come goes
 * in the section it is about. Taking the project out of Althar isn't a
 * section: it is the one thing to do at the foot of the side.
 */

export const PROJECT_SECTIONS = ['general', 'code', 'rules', 'running', 'notes'] as const

export type ProjectSection = (typeof PROJECT_SECTIONS)[number]

export const isProjectSection = (value: unknown): value is ProjectSection =>
  typeof value === 'string' && (PROJECT_SECTIONS as ReadonlyArray<string>).includes(value)

/** The headings' ranks: under the project's name, the screen's own heading, the section's title, then each part of it. */
export const HEADING = { title: 2, part: 3 } as const

/** The section Settings opens on, where nothing asks for another. */
export const FIRST_PROJECT_SECTION: ProjectSection = 'general'

/** The sections in their groups, a little apart down the side. */
export const PROJECT_GROUPS: ReadonlyArray<ReadonlyArray<ProjectSection>> = [['general', 'code'], ['rules', 'running'], ['notes']]

export const projectSectionText: Readonly<
  Record<ProjectSection, { readonly title: string; readonly lede: string; readonly icon: IconName }>
> = {
  general: { title: 'General', lede: 'Its name and colour, and how its tasks work.', icon: 'gear' },
  code: {
    title: 'Code and issues',
    lede: 'Its repositories and where their work goes, and the trackers its tasks’ issues are on.',
    icon: 'plug',
  },
  rules: {
    title: 'Rules',
    lede: 'What agents may do without asking, what waits for you, and how a task ends. For every task, from its next request on.',
    icon: 'lock',
  },
  running: { title: 'Running', lede: 'What it runs with no agent, and where its tasks’ work goes.', icon: 'play' },
  notes: { title: 'Notes', lede: 'What the coordinator keeps from your conversations, that the code doesn’t show.', icon: 'quote' },
}
