import { at } from './0001_initial/columns'

/*
 * When the person last opened a task's screen (DEV-96). A plain task that
 * finished waits in its project's Needs you as Finished until it is seen;
 * seeing it settles it as done. Null until it is first opened.
 */
export const statements: ReadonlyArray<string> = [`ALTER TABLE tasks ADD COLUMN ${at('seen_at', { nullable: true })}`]
