/*
 * What the person asked for, in their own words, kept with the task its
 * request became: the message to the coordinator it was drafted from, or what
 * they wrote making it themselves. Its thread opens with it, so what they
 * wanted is never only in the title or in the lead's brief.
 */
export const statements: ReadonlyArray<string> = ['ALTER TABLE tasks ADD COLUMN request TEXT']
