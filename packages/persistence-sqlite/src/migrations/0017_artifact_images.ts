/*
 * Pictures an agent hands back, in a message or a tool's result, are kept in
 * the artifact store as their own kind, so their retention can differ from
 * a command's output (a log) and from documents (docs/architecture/07).
 */
export const statements: ReadonlyArray<string> = [`INSERT INTO vocab_artifact_kind (word) VALUES ('image')`]
