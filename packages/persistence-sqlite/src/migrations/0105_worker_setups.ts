/*
 * A repository's setup for its workers, as a lead recorded it on one (ADR-103): the commands that get a task's checkout
 * ready there, which a worker runs before each later task's lead starts, on any worker. Apart from the setup recorded
 * on the home, which runs in the person's own shell with their tools: what a worker lacks, its lead installs into its
 * own folders and records here. JSON, as `recorded_setup` is; null until a lead on a worker records one.
 */
export const statements: ReadonlyArray<string> = ['ALTER TABLE repository_bindings ADD COLUMN worker_setup TEXT']
