/*
 * A project's settings' sections, as the app has them, with Other tools
 * beside Code and issues: what other tools left in its folders and what came
 * in (Settings' first and third directions). In the second, it's Althar's
 * own settings that have it, for every project at once.
 */
import type { IconName } from '@althar/ui'

import * as app from '../../src/renderer/features/projectSettings/sections'
import { lab } from './state'

export { FIRST_PROJECT_SECTION, HEADING } from '../../src/renderer/features/projectSettings/sections'

export type ProjectSection = app.ProjectSection | 'import'

export const PROJECT_SECTIONS: ReadonlyArray<ProjectSection> = [...app.PROJECT_SECTIONS, 'import']

export const isProjectSection = (value: unknown): value is ProjectSection =>
  typeof value === 'string' && (PROJECT_SECTIONS as ReadonlyArray<string>).includes(value)

/** Other tools only where this direction keeps it: read once, as the page loads on a direction. */
const groups = (): ReadonlyArray<ReadonlyArray<ProjectSection>> =>
  lab.get().d === '2' ? app.PROJECT_GROUPS : [['general', 'code', 'import'], ...app.PROJECT_GROUPS.slice(1)]
export const PROJECT_GROUPS = groups()

export const projectSectionText: Readonly<Record<ProjectSection, { readonly title: string; readonly icon: IconName }>> = {
  ...app.projectSectionText,
  import: { title: 'Other tools', icon: 'download' },
}
