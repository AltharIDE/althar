import { PROJECT_SETTINGS_SECTIONS } from '@althar/contracts'
import type { IconName } from '@althar/ui'

/*
 * A project's settings, by what each is about, as its Settings view lists
 * them down its side and its address names them: what it is, and what its
 * code and issues are; how its tasks start, go and end; what its agents may
 * do, and what it runs; then what its coordinator keeps. A setting to come goes
 * in the section it is about. Taking the project out of Althar isn't a
 * section: it is the one thing to do at the foot of the side.
 */

/** As contracts lists them, so the agents' read_settings names the same sections (ADR-097). */
export const PROJECT_SECTIONS = PROJECT_SETTINGS_SECTIONS

export type ProjectSection = (typeof PROJECT_SECTIONS)[number]

export const isProjectSection = (value: unknown): value is ProjectSection =>
  typeof value === 'string' && (PROJECT_SECTIONS as ReadonlyArray<string>).includes(value)

/** The headings' ranks: under the project's name, the screen's own heading, the section's title, then each part of it. */
export const HEADING = { title: 2, part: 3 } as const

/** The section Settings opens on, where nothing asks for another. */
export const FIRST_PROJECT_SECTION: ProjectSection = 'general'

/** The sections in their groups, a little apart down the side. */
export const PROJECT_GROUPS: ReadonlyArray<ReadonlyArray<ProjectSection>> = [['general', 'code'], ['tasks', 'rules', 'running'], ['notes']]

/** Each section's name and icon. */
export const projectSectionText: Readonly<Record<ProjectSection, { readonly title: string; readonly icon: IconName }>> = {
  general: { title: 'General', icon: 'gear' },
  code: { title: 'Code and issues', icon: 'plug' },
  tasks: { title: 'Tasks', icon: 'work' },
  rules: { title: 'Rules', icon: 'lock' },
  running: { title: 'Running', icon: 'play' },
  notes: { title: 'Notes', icon: 'quote' },
}
