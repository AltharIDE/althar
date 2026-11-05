/*
 * A task may work toward a branch other than its repository's default, such
 * as `release/0.8.0` (ADR-093): it starts from that branch, its pull request
 * goes into it, and keeping it current, its conflicts, its checks and its
 * diff go by it. `workspaces.toward` is the branch a task's work in one
 * repository goes into; `repository_bindings.work_toward` is the project's
 * default for new tasks there ("Work toward", in General). Both are null for
 * the repository's default branch, so every task and project made before
 * keeps going to it.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE workspaces ADD COLUMN toward TEXT',
  'ALTER TABLE repository_bindings ADD COLUMN work_toward TEXT',
]
