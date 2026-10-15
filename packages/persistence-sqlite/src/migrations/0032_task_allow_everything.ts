/*
 * A task's own allow everything (ADR-036): the person turned it on from the
 * task's menu, so nothing its agents ask waits for them, short of what its
 * project never allows. Off for every task until then; its project's rules
 * can allow everything for all of them.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE tasks ADD COLUMN allow_everything INTEGER NOT NULL DEFAULT 0 CHECK (allow_everything IN (0, 1))',
]
