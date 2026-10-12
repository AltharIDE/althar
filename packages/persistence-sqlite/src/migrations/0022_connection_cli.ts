import { vocabulary } from './0001_initial/columns'

/*
 * A connection made with gh's or glab's sign-in on this device says which
 * tool it came from (docs/architecture/06, "Signing in"). Its token is a copy
 * of the tool's, which the tool may replace: when the copy stops working,
 * Althar asks the tool for the one it has now before it asks the person to
 * sign in again. `none` for one signed in any other way, a pasted token
 * among them, which no tool's sign-in takes over; null for one made before
 * Althar noted it.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('connection_cli', ['gh', 'glab', 'none']),
  'ALTER TABLE connections ADD COLUMN cli TEXT REFERENCES vocab_connection_cli (word)',
]
