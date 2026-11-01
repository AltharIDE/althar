/*
 * A repository's setup, as a lead recorded it (ADR-023): the ignored files
 * to copy from the person's checkout into each new task folder, and the
 * commands that get it ready, which Althar runs itself, outside any agent's
 * sandbox, before each later task's lead starts. JSON; null until a lead
 * records one, or once the person clears it.
 */
export const statements: ReadonlyArray<string> = ['ALTER TABLE repository_bindings ADD COLUMN recorded_setup TEXT']
