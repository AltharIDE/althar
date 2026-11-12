import type { ChangeRequest, CodeHost, Repository } from '@althar/connectors'
import { Ids, newId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { timestamp } from './records'

/*
 * Althar's own updates of a pull request's branch on its host (ADR-081's
 * update_branch, the coordinator's or the merge line's): a merge of its
 * target into it, made there, never pushed from this Mac. Each is kept on
 * the pull request's link as Althar asked for it, and read back once, so the
 * merge it made counts as Althar's, not someone else's push: the lead's
 * commits on top of it still go up by themselves (ADR-072).
 *
 * Only a merge of the target's head into the head Althar asked from counts:
 * the head a host says may be someone else's push (GitHub's update-branch
 * lands in the background, and the head read after may not be its own), so
 * where the host can tell (`madeFrom`), a head is Althar's only where it is
 * that merge.
 */

/** An update Althar asked of its host: from the branch's head `from`, merging the target's head `base` where it read one, to `head` as the host said (null where it lands in the background). */
export interface BranchUpdate {
  readonly from: string
  readonly base: string | null
  readonly head: string | null
}

interface Link {
  readonly id: string
  readonly projectId: string
  readonly product: string
}

const observe = (link: Link, kind: string, id: string, payload: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
      id: yield* newId(Ids.observation),
      projectId: link.projectId,
      subjectType: 'external_link',
      subjectId: link.id,
      kind,
      payload: JSON.stringify({ ...payload, id }),
      source: link.product,
      observedAt: yield* timestamp,
    })}`
  })

/** Keeps an update Althar made of the branch of the project's pull request at `url`, on each task's link to it. */
export const keepUpdate = (projectId: string, url: string, update: BranchUpdate) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const links = yield* sql<Link>`
      SELECT id, project_id, product FROM external_links WHERE project_id = ${projectId} AND url = ${url} AND kind = 'change'`
    for (const link of links)
      yield* observe(link, 'branch_updated', `updated:${update.from}:${update.base ?? ''}:${update.head ?? ''}`, { ...update })
  }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep that Althar brought a branch up to date', cause)))

/**
 * Whether the branch of a pull request, at `there` on its host, is where
 * Althar left it: its last push (`sent`), or a merge one of its updates made
 * from there, one update after another. An update not read back yet is read
 * once and kept: the head it made is the head its host said, else the head
 * the next update started from, else `there`; where the host can tell, it is
 * Althar's only where it is the merge of `base` into `from`. `read` is the
 * pull request as its host has it now, asked only where an update needs it.
 */
export const leftByAlthar = (input: {
  readonly link: Link
  readonly host: CodeHost
  readonly repository: Repository
  readonly read: Effect.Effect<ChangeRequest, unknown>
  readonly there: string
  readonly sent: string | null
}) =>
  Effect.gen(function* () {
    const { link, host, repository, there, sent } = input
    if (sent === null) return false
    if (there === sent) return true
    const sql = yield* SqlClient.SqlClient
    const updates = yield* sql<{
      id: string
      fromHead: string
      base: string | null
      head: string | null
      readBack: number
      made: string | null
    }>`
      SELECT json_extract(u.payload, '$.id') AS id, json_extract(u.payload, '$.from') AS from_head,
        json_extract(u.payload, '$.base') AS base, json_extract(u.payload, '$.head') AS head,
        r.id IS NOT NULL AS read_back, json_extract(r.payload, '$.made') AS made
      FROM observations u
      LEFT JOIN observations r ON r.subject_type = 'external_link' AND r.subject_id = u.subject_id AND r.kind = 'branch_update_read'
        AND json_extract(r.payload, '$.update') = json_extract(u.payload, '$.id')
      WHERE u.subject_type = 'external_link' AND u.subject_id = ${link.id} AND u.kind = 'branch_updated'
      ORDER BY u.observed_at, u.rowid`
    const madeFrom = host.madeFrom
    const read = yield* Effect.cached(input.read)
    const ours = new Set([sent])
    for (const [at, update] of updates.entries()) {
      if (ours.has(there)) return true
      if (!ours.has(update.fromHead)) continue
      if (update.readBack === 1) {
        if (update.made !== null) ours.add(update.made)
        continue
      }
      const candidate = update.head ?? updates[at + 1]?.fromHead ?? there
      // Still where it was asked from: it hasn't landed yet, and is read once it has.
      if (ours.has(candidate)) continue
      const made =
        madeFrom === undefined
          ? update.head
          : yield* read.pipe(
              Effect.flatMap((change) =>
                madeFrom(repository, { ...change, headSha: candidate }, update.fromHead, update.base ?? undefined),
              ),
              Effect.map((is) => (is ? candidate : null)),
              // Not answered now: asked again on the next look.
              Effect.orElseSucceed(() => undefined),
            )
      if (made === undefined) continue
      yield* observe(link, 'branch_update_read', `read:${update.id}`, { update: update.id, made })
      if (made !== null) ours.add(made)
    }
    return ours.has(there)
  })
