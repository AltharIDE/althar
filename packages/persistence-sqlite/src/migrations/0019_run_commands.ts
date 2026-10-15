/*
 * How Althar runs a repository itself, with no agent (ADR-023): the command
 * that runs it, such as `bun run dev`, and what makes a fresh copy ready
 * first, such as installing its packages. Both null until one is kept: until
 * then Althar works them out from the repository. And a process of Althar's
 * own kind, the project run, so a run left by an earlier launch is stopped as
 * an agent's is; and a thread item for a run, in the thread it was asked for
 * in, which Althar keeps current.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE repository_bindings ADD COLUMN run_command TEXT',
  'ALTER TABLE repository_bindings ADD COLUMN run_setup TEXT',
  "INSERT INTO vocab_process_purpose (word) VALUES ('run')",
  "INSERT INTO vocab_thread_item_kind (word) VALUES ('run')",
]
