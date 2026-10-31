import type { IconName } from '@althar/ui'

import { device } from '../../shared/device'

/*
 * Althar's settings, by what each is about, as the Settings tab lists them
 * down its side and its address names them: the agents and the code hosts
 * Althar works with, and the skills the agents are given; then its own ways (work on this computer, reviews and
 * pull requests, notifications, how it looks, the editor); then which
 * Althar this is. A setting to come goes in the section it is about, and a
 * section to come between those it sits among.
 */

export const SECTIONS = ['agents', 'skills', 'code-hosts', 'this-mac', 'reviews', 'notifications', 'appearance', 'editor', 'about'] as const

export type Section = (typeof SECTIONS)[number]

export const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (SECTIONS as ReadonlyArray<string>).includes(value)

/** The section the Settings tab opens on, before it has been on one. */
export const FIRST_SECTION: Section = 'agents'

/** The sections in their groups, a little apart down the side. */
export const GROUPS: ReadonlyArray<ReadonlyArray<Section>> = [
  ['agents', 'skills', 'code-hosts'],
  ['this-mac', 'reviews', 'notifications', 'appearance', 'editor'],
  ['about'],
]

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly icon: IconName }>> = {
  agents: { title: 'Agents', icon: 'agents' },
  skills: { title: 'Skills', icon: 'knowledge' },
  'code-hosts': { title: 'Code hosts and trackers', icon: 'plug' },
  'this-mac': { title: `Work on ${device.this}`, icon: 'load' },
  reviews: { title: 'Reviews and pull requests', icon: 'pr' },
  notifications: { title: 'Notifications', icon: 'bell' },
  appearance: { title: 'Appearance', icon: 'image' },
  editor: { title: 'Editor', icon: 'file' },
  about: { title: 'About Althar', icon: 'down' },
}
