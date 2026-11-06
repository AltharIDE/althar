// Scrappy: Althar's Settings sections, with What asks among them, for What asks' B: the person's own, in every project.
import type { IconName } from '../../../src/foundations/Icon/Icon'
import {
  FIRST_SECTION as REAL_FIRST,
  GROUPS as REAL_GROUPS,
  SECTIONS as REAL_SECTIONS,
  sectionText as realText,
} from '../../../../../apps/desktop/src/renderer/features/settings/sections'

export const SECTIONS = [...REAL_SECTIONS, 'what-asks'] as const
export type Section = (typeof SECTIONS)[number]
export const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (SECTIONS as ReadonlyArray<string>).includes(value)
export const FIRST_SECTION = REAL_FIRST
/** The side lists it only where the direction shows it: the nav's seam puts it in. */
export const GROUPS = REAL_GROUPS
export const sectionText: Readonly<Record<Section, { readonly title: string; readonly icon: IconName }>> = {
  ...realText,
  'what-asks': { title: 'What asks', icon: 'lock' },
}
