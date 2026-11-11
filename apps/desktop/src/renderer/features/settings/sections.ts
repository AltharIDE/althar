import { SETTINGS_SECTIONS, settingsSectionOf } from '@althar/contracts'
import type { IconName } from '@althar/ui'

import { device } from '../../shared/device'

/*
 * Althar's settings, by what each is about, as the Settings tab lists them
 * down its side and its address names them: the agents and the code hosts
 * Althar works with, and the MCP servers and skills the agents are given;
 * then how its work goes (tasks, pull requests), its own ways (work on this
 * computer, notifications, how it looks, the editor and the pages beside
 * conversations); then which Althar this is. A setting to come goes in the
 * section it is about, and a section to come between those it sits among.
 */

/** As contracts lists them, so the agents' read_settings names the same sections (ADR-097). */
export const SECTIONS = SETTINGS_SECTIONS

export type Section = (typeof SECTIONS)[number]

export const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (SECTIONS as ReadonlyArray<string>).includes(value)

/** The section an address names, an old one included: where its settings went (`MOVED_SETTINGS_SECTIONS`); undefined for anything else. */
export const sectionOf = (value: unknown): Section | undefined => settingsSectionOf(value)

/** The section the Settings tab opens on, before it has been on one. */
export const FIRST_SECTION: Section = 'agents'

/** The sections in their groups, a little apart down the side. */
export const GROUPS: ReadonlyArray<ReadonlyArray<Section>> = [
  ['agents', 'mcp-servers', 'skills', 'code-hosts'],
  ['tasks', 'pull-requests', 'this-mac', 'notifications', 'appearance', 'editor-and-browser'],
  ['about'],
]

export const sectionText: Readonly<Record<Section, { readonly title: string; readonly icon: IconName }>> = {
  agents: { title: 'Agents', icon: 'agents' },
  'mcp-servers': { title: 'MCP servers', icon: 'plug' },
  skills: { title: 'Skills', icon: 'knowledge' },
  'code-hosts': { title: 'Code hosts and trackers', icon: 'branch' },
  tasks: { title: 'Tasks', icon: 'work' },
  'pull-requests': { title: 'Pull requests', icon: 'pr' },
  'this-mac': { title: `Work on ${device.this}`, icon: 'load' },
  notifications: { title: 'Notifications', icon: 'bell' },
  appearance: { title: 'Appearance', icon: 'image' },
  'editor-and-browser': { title: 'Editor and browser', icon: 'file' },
  about: { title: 'About Althar', icon: 'down' },
}
