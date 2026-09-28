import { agents } from './0001_initial/agents'
import { attention } from './0001_initial/attention'
import { conversation } from './0001_initial/conversation'
import { effects } from './0001_initial/effects'
import { projects } from './0001_initial/projects'
import { record } from './0001_initial/record'
import { work } from './0001_initial/work'

/** The first schema: every table the first demo needs. */
export const statements: ReadonlyArray<string> = [...projects, ...work, ...conversation, ...agents, ...attention, ...effects, ...record]
