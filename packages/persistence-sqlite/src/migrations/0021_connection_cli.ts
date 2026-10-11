import { vocabulary } from './0001_initial/columns'

/*
 * A connection made with gh's or glab's sign-in on this device says which
 * tool it came from (docs/architecture/06, "Signing in"). Its token is a copy
 * of the tool's, which the tool may replace: when the copy stops working,
 * Althar asks the tool for the one it has now before it asks the person to
 * sign in again. None for a connection signed in any other way.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('connection_cli', ['gh', 'glab']),
  'ALTER TABLE connections ADD COLUMN cli TEXT REFERENCES vocab_connection_cli (word)',
]
