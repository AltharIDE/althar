/*
 * A project's rules started from its agents' own settings (DEV-41,
 * ADR-034): offered once, as the project is made, and standing until the
 * person takes the rules found, some of them or none. Projects made before
 * aren't offered it; their rules screen imports whenever the person asks.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE projects ADD COLUMN offers_agent_rules INTEGER NOT NULL DEFAULT 0 CHECK (offers_agent_rules IN (0, 1))',
]
