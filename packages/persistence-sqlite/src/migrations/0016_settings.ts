import { at, index, table } from './0001_initial/columns'

/*
 * The person's settings for the app as a whole, kept for the profile: one row
 * a setting, by its key, and only once they change it from its default. The
 * first is whether Althar signs the work it sends to a code host as its
 * co-author (docs/architecture/06).
 *
 * And the commits Althar made again of agents' commits, each by the commit
 * it was made from, so the same commit always goes the same way, and one
 * Althar made is never made again.
 */
export const statements: ReadonlyArray<string> = [
  table('settings', ['key TEXT PRIMARY KEY NOT NULL', 'value TEXT NOT NULL', at('updated_at')]),
  table('credited_commits', ['original TEXT PRIMARY KEY NOT NULL', 'credited TEXT NOT NULL', at('made_at')]),
  index('credited_commits_by_credited', 'credited_commits (credited)'),
]
