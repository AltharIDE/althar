import { at } from './0001_initial/columns'

/*
 * When the person last opened a task's folder from Althar, in an editor or
 * the file manager (ADR-055). A finished task's folder waits from the latest
 * of this, when it settled and when its screen was last opened, before it
 * is removed; opened within the last day, it is held back. Null until first
 * opened.
 */
export const statements: ReadonlyArray<string> = [`ALTER TABLE tasks ADD COLUMN ${at('opened_at', { nullable: true })}`]
