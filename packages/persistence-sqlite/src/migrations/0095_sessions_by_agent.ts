/*
 * An agent's latest session, found by an index (docs/decisions/foundations.md, "What is read on every change is found
 * by an index"): the models' catalogue reads each agent's, for what it was last on, at every read, and a model picker
 * reads the catalogue again after each change the person makes in it. Without it, each read scanned every session.
 */
export const statements: ReadonlyArray<string> = ['CREATE INDEX provider_sessions_by_agent ON provider_sessions (agent_id, started_at)']
