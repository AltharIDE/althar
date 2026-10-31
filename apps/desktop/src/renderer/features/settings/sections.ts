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

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly lede: string; readonly icon: IconName }>> = {
  agents: {
    title: 'Agents',
    lede: `The agents on ${device.this}, the accounts each signs in with, and the models their work may use.`,
    icon: 'agents',
  },
  skills: {
    title: 'Skills',
    lede: 'What each task’s lead is given as it starts, whichever agent leads it: the skills Althar ships and any you install from GitHub.',
    icon: 'knowledge',
  },
  'code-hosts': {
    title: 'Code hosts and trackers',
    lede: 'Where your code and issues are. Connected once, for every project.',
    icon: 'plug',
  },
  'this-mac': {
    title: `Work on ${device.this}`,
    lede: `How much work ${device.this} takes on at once, keeping it awake for it, showing how hard it works, when finished tasks’ folders go, and when automations run.`,
    icon: 'load',
  },
  reviews: {
    title: 'Reviews and pull requests',
    lede: 'What Althar does with pull requests without asking you, and how it signs its work.',
    icon: 'pr',
  },
  notifications: { title: 'Notifications', lede: 'Only while Althar isn’t in front. Never for progress.', icon: 'bell' },
  appearance: { title: 'Appearance', lede: 'Light or dark, how Althar shows while you work in another app, and its icon.', icon: 'image' },
  editor: { title: 'Editor', lede: 'Which app a task’s files and folder open in.', icon: 'file' },
  about: {
    title: 'About Althar',
    lede: 'Which Althar this is, a newer one once it’s ready, the anonymous usage data and crash reports it sends, and where to report a problem.',
    icon: 'down',
  },
}
