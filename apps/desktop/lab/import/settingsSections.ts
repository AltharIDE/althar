/*
 * Althar's settings' sections, as the app has them, with Other tools among
 * them in Settings' second direction: every tool found on this computer, and
 * what each has for every project.
 */
import type { IconName } from '@althar/ui'

import * as app from '../../src/renderer/features/settings/sections'
import { lab } from './state'

export { FIRST_SECTION } from '../../src/renderer/features/settings/sections'

export type Section = app.Section | 'other-tools'

export const SECTIONS: ReadonlyArray<Section> = [...app.SECTIONS, 'other-tools']

export const isSection = (value: unknown): value is Section => value === 'other-tools' || app.isSection(value)

export const sectionOf = (value: unknown): Section | undefined => (value === 'other-tools' ? value : app.sectionOf(value))

const groups = (): ReadonlyArray<ReadonlyArray<Section>> =>
  lab.get().d === '2' ? [['agents', 'mcp-servers', 'skills', 'code-hosts', 'other-tools'], ...app.GROUPS.slice(1)] : app.GROUPS
export const GROUPS = groups()

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly icon: IconName }>> = {
  ...app.sectionText,
  'other-tools': { title: 'Other tools', icon: 'download' },
}
