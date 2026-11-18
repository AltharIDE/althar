/* The project's settings sections, as its page names them in the lab: Rules is People and rules, in D. */
import { projectSectionText as real } from '../../../src/renderer/features/projectSettings/sections'

export * from '../../../src/renderer/features/projectSettings/sections'

export const projectSectionText = { ...real, rules: { title: 'People and rules', icon: 'lock' as const } }
