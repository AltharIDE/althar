// Scrappy: Settings' sections, with Browser after Editor: where a page opens, and how long its cookies are kept.
import type { IconName } from '../../../src/foundations/Icon/Icon'
import * as built from '../../../../../apps/desktop/src/renderer/features/settings/sections'

export type Section = built.Section | 'browser'

export const SECTIONS: ReadonlyArray<Section> = built.SECTIONS.flatMap((one): Section[] => (one === 'editor' ? [one, 'browser'] : [one]))

export const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (SECTIONS as ReadonlyArray<string>).includes(value)

export const FIRST_SECTION = built.FIRST_SECTION

export const GROUPS: ReadonlyArray<ReadonlyArray<Section>> = built.GROUPS.map((group) =>
  group.flatMap((one): Section[] => (one === 'editor' ? [one, 'browser'] : [one])),
)

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly icon: IconName }>> = {
  ...built.sectionText,
  browser: { title: 'Browser', icon: 'globe' },
}
