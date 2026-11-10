/*
 * How far a task trusts the code of a pull request it reviews (a task is a
 * conversation plus parts, "Running someone else's pull request"), on its
 * review's workspace: none (null), it only reads its copy; `safe`, the person
 * said Run safely, so its packages are installed with their install scripts
 * off and its commands run offline in the sandbox; `full`, the person said
 * Trust fully, or it is the team's own, so it is set up and runs as the
 * team's code does, with the network.
 */
export const statements: ReadonlyArray<string> = [`ALTER TABLE workspaces ADD COLUMN trust TEXT CHECK (trust IN ('safe', 'full'))`]
