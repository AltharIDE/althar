import { at, json, project, revision, sameProject, table } from './0001_initial/columns'

/*
 * The screenshots a task's pull request shows (ADR-076): one comment on it,
 * which Althar wrote and writes anew as they change. For each pull request,
 * by its link: that comment, once there is one; what it shows now, each by
 * its view and picture, with where the host serves it; what it showed
 * before, for its earlier versions; the views the person left out of it;
 * every picture uploaded for it, by its digest, since the host keeps an
 * upload for good and one is never sent twice; when it was last posted;
 * and why the last try failed, where it did.
 */
export const statements: ReadonlyArray<string> = [
  table(
    'pull_request_pictures',
    [
      'link_id TEXT PRIMARY KEY NOT NULL',
      project(),
      'comment_id TEXT',
      'comment_url TEXT',
      json('shown', { empty: '[]' }),
      json('earlier', { empty: '[]' }),
      json('left_out', { empty: '[]' }),
      json('uploads', { empty: '{}' }),
      at('posted_at', { nullable: true }),
      'failed TEXT',
      at('updated_at'),
      revision,
    ],
    [sameProject('link_id', 'external_links')],
  ),
]
