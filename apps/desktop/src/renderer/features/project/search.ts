import { Room } from '@althar/ui'

import { isProjectSection, type ProjectSection } from '../projectSettings/sections'

/** What a project opens on, when something asks: a view, of its settings a section, and of its automations the one open, or `new`. */
export interface ProjectSearch {
  readonly room?: Room
  readonly section?: ProjectSection
  readonly automation?: string
}

/** The view an address names, if it names one. */
const roomOf = (value: unknown): Room | undefined => Object.values(Room).find((room) => room === value)

/** What an address asks a project to open on, of what it says. */
export const projectSearchOf = (search: Record<string, unknown>): ProjectSearch => {
  const room = roomOf(search.room)
  return {
    ...(room === undefined ? {} : { room }),
    ...(isProjectSection(search.section) ? { section: search.section } : {}),
    ...(typeof search.automation === 'string' && search.automation !== '' ? { automation: search.automation } : {}),
  }
}

/** Where one of a project's settings is: its Settings view, at a section. */
export const settingsSearch = (section: ProjectSection): ProjectSearch => ({ room: Room.Settings, section })
