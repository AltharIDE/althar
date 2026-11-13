import { Effect, Schema } from 'effect'

import { ConnectorFailed } from './errors'
import { type Http, paged } from './http'
import type { Account, NewReview, PostedReview } from './model'

type Product = 'gitlab' | 'bitbucket_cloud' | 'bitbucket_dc'
const TextId = Schema.Union([Schema.String, Schema.Number])
const Comment = Schema.Struct({ id: TextId })

/** Bitbucket Cloud can abbreviate a hash in a PR response; only a full reviewed SHA may match that prefix. */
export const reviewCommitMatches = (reviewed: string, current: string | null): boolean =>
  current === reviewed ||
  (current !== null &&
    current.length >= 12 &&
    current.length < 40 &&
    /^[a-f0-9]{40}$/i.test(reviewed) &&
    /^[a-f0-9]+$/i.test(current) &&
    reviewed.toLowerCase().startsWith(current.toLowerCase()))

/** All writes are one runtime receipt. A partial multi-call review must never be replayed. */
export const postHostReview = (
  product: Product,
  http: Pick<Http, 'json'> & Partial<Pick<Http, 'graphql'>>,
  base: string,
  review: NewReview,
  account: Effect.Effect<Account, ConnectorFailed>,
  graphql?: { readonly url: string; readonly project: string; readonly number: number },
): Effect.Effect<PostedReview, ConnectorFailed> =>
  Effect.suspend(() => {
    let completed = 0
    const rejected = (message: string) => new ConnectorFailed({ product, reason: 'rejected', message })
    const snapshot = Effect.gen(function* () {
      if (product === 'gitlab') {
        const one = yield* http.json(
          Schema.Struct({
            sha: Schema.String,
            author: Schema.Struct({ id: Schema.Number }),
            diff_refs: Schema.Struct({ base_sha: Schema.String, start_sha: Schema.String, head_sha: Schema.String }),
          }),
          'GET',
          base,
        )
        return { head: one.sha, base: one.diff_refs.base_sha, start: one.diff_refs.start_sha, author: String(one.author.id) }
      }
      if (product === 'bitbucket_cloud') {
        const one = yield* http.json(
          Schema.Struct({
            source: Schema.Struct({ commit: Schema.Struct({ hash: Schema.String }) }),
            destination: Schema.Struct({ commit: Schema.Struct({ hash: Schema.String }) }),
            author: Schema.Struct({ uuid: Schema.String }),
          }),
          'GET',
          base,
        )
        return {
          head: one.source.commit.hash,
          base: one.destination.commit.hash,
          start: one.destination.commit.hash,
          author: one.author.uuid,
        }
      }
      const one = yield* http.json(
        Schema.Struct({
          fromRef: Schema.Struct({ latestCommit: Schema.String }),
          toRef: Schema.Struct({ latestCommit: Schema.String }),
          author: Schema.Struct({ user: Schema.Struct({ id: Schema.Number }) }),
        }),
        'GET',
        base,
      )
      return {
        head: one.fromRef.latestCommit,
        base: one.toRef.latestCommit,
        start: one.toRef.latestCommit,
        author: String(one.author.user.id),
      }
    })
    return Effect.gen(function* () {
      const now = yield* snapshot
      const me = yield* account
      if (review.event === 'comment' && review.body.trim() === '' && review.comments.length === 0)
        return yield* rejected('A comment review needs a summary or inline comments.')
      if (review.commit !== null && !reviewCommitMatches(review.commit, now.head))
        return yield* rejected('The head moved. Review the current commit before posting.')
      if (review.event === 'approve' && now.author === me.id) return yield* rejected('An account cannot approve its own change.')
      const planned: Array<{ path: string; body: unknown }> = []
      if (
        review.comments.some(
          (one) =>
            one.path === '' ||
            one.path.startsWith('/') ||
            one.path.includes('\\') ||
            one.path.split('/').some((part) => part === '.' || part === '..'),
        )
      )
        return yield* rejected('Review paths must be relative repository files without traversal.')
      if (review.comments.some((one) => !Number.isSafeInteger(one.line) || one.line < 1))
        return yield* rejected('Review lines must be positive integers.')
      if (product === 'gitlab' && review.comments.length > 0) {
        const files = yield* paged(1, (page) =>
          http
            .json(
              Schema.Array(Schema.Struct({ old_path: Schema.String, new_path: Schema.String, diff: Schema.String })),
              'GET',
              `${base}/diffs?per_page=100&page=${page}`,
            )
            .pipe(Effect.map((items) => ({ items, next: items.length === 100 ? page + 1 : undefined }))),
        )
        for (const comment of review.comments) {
          const file = files.find((one) => one.new_path === comment.path)
          const line = file === undefined ? null : rightLine(file.diff, comment.line)
          if (file === undefined || line === null)
            return yield* rejected(`The review line is outside the current diff: ${comment.path}:${comment.line}.`)
          planned.push({
            path: `${base}/discussions`,
            body: {
              body: comment.body,
              position: {
                position_type: 'text',
                base_sha: now.base,
                start_sha: now.start,
                head_sha: now.head,
                old_path: file.old_path,
                new_path: file.new_path,
                new_line: comment.line,
                ...(line.old === null ? {} : { old_line: line.old }),
              },
            },
          })
        }
      } else if (product === 'bitbucket_cloud') {
        for (const comment of review.comments)
          planned.push({
            path: `${base}/comments`,
            body: { content: { raw: comment.body }, inline: { path: comment.path, to: comment.line } },
          })
      } else if (product === 'bitbucket_dc') {
        for (const comment of review.comments) {
          const diff = yield* http.json(
            Schema.Struct({
              fromHash: Schema.optional(Schema.String),
              toHash: Schema.optional(Schema.String),
              diffs: Schema.Array(
                Schema.Struct({
                  source: Schema.optional(Schema.Struct({ toString: Schema.String })),
                  hunks: Schema.Array(
                    Schema.Struct({
                      segments: Schema.Array(
                        Schema.Struct({
                          type: Schema.String,
                          lines: Schema.Array(Schema.Struct({ destination: Schema.optional(Schema.Number) })),
                        }),
                      ),
                    }),
                  ),
                }),
              ),
            }),
            'GET',
            `${base}/diff/${comment.path.split('/').map(encodeURIComponent).join('/')}?withComments=false`,
          )
          const file = diff.diffs.find((one) =>
            one.hunks.some((hunk) => hunk.segments.some((segment) => segment.lines.some((line) => line.destination === comment.line))),
          )
          const segment = file?.hunks
            .flatMap((hunk) => hunk.segments)
            .find((one) => one.type !== 'REMOVED' && one.lines.some((line) => line.destination === comment.line))
          if (segment === undefined || !['ADDED', 'CONTEXT'].includes(segment.type))
            return yield* rejected(`The review line is outside the current diff: ${comment.path}:${comment.line}.`)
          if (diff.toHash !== undefined && !reviewCommitMatches(now.head, diff.toHash))
            return yield* rejected('The diff head moved while preparing inline comments.')
          planned.push({
            path: `${base}/comments`,
            body: {
              text: comment.body,
              anchor: {
                diffType: 'EFFECTIVE',
                fileType: 'TO',
                lineType: segment.type,
                fromHash: diff.fromHash ?? now.base,
                toHash: diff.toHash ?? now.head,
                path: comment.path,
                srcPath: file?.source?.toString ?? comment.path,
                line: comment.line,
              },
            },
          })
        }
      }
      if (review.body !== '')
        planned.push({
          path: `${base}/${product === 'gitlab' ? 'notes' : 'comments'}`,
          body:
            product === 'gitlab'
              ? { body: review.body }
              : product === 'bitbucket_cloud'
                ? { content: { raw: review.body } }
                : { text: review.body },
        })
      let id = `${now.head}:${review.event}`
      if ((yield* snapshot).head !== now.head)
        return yield* rejected('The head moved while preparing the review. Read the current change before posting.')
      for (const one of planned) {
        const posted = yield* http.json(Comment, 'POST', one.path, one.body)
        id = String(posted.id)
        completed++
      }
      if (review.event !== 'comment') {
        const fresh = yield* snapshot
        if (fresh.head !== now.head)
          return yield* rejected('The head moved before the verdict. Read the current change before trying again.')
        if (product === 'gitlab' && review.event === 'request_changes') {
          if (http.graphql === undefined || graphql === undefined)
            return yield* rejected('GitLab needs its GraphQL review operation to request changes.')
          const answer = yield* http.graphql(
            Schema.Struct({ mergeRequestRequestChanges: Schema.Struct({ errors: Schema.Array(Schema.String) }) }),
            graphql.url,
            'mutation($path: ID!, $iid: String!) { mergeRequestRequestChanges(input: { projectPath: $path, iid: $iid }) { errors } }',
            { path: graphql.project, iid: String(graphql.number) },
          )
          if (answer.mergeRequestRequestChanges.errors.length > 0)
            return yield* rejected(answer.mergeRequestRequestChanges.errors.join('; '))
        } else if (product === 'bitbucket_dc') {
          yield* http.json(Schema.Unknown, 'PUT', `${base}/participants/${encodeURIComponent(me.login)}`, {
            status: review.event === 'approve' ? 'APPROVED' : 'NEEDS_WORK',
            lastReviewedCommit: now.head,
          })
        } else {
          yield* http.json(
            Schema.Unknown,
            'POST',
            `${base}/${review.event === 'approve' ? 'approve' : 'request-changes'}`,
            product === 'gitlab' ? { sha: now.head } : {},
          )
        }
        completed++
        if ((yield* snapshot).head !== now.head)
          return yield* rejected('The head moved while the verdict was being posted; its outcome needs checking.')
      }
      return { id, url: null }
    }).pipe(
      Effect.mapError((error) =>
        completed === 0 && error.sizeLimit === undefined
          ? error
          : new ConnectorFailed({
              product,
              reason: 'invalid_response',
              message: `Part of this review was posted; do not repeat it. Read its comments and verdict before continuing. ${error.message}`,
            }),
      ),
    )
  })

/** The old-side coordinate is required on unchanged GitLab discussion lines. */
const rightLine = (diff: string, wanted: number): { old: number | null } | null => {
  let old = 0
  let next = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk !== null) {
      old = Number(hunk[1])
      next = Number(hunk[2])
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if ((line.startsWith('+') || line.startsWith(' ')) && next === wanted) return { old: line.startsWith('+') ? null : old }
    if (line.startsWith('-') || line.startsWith(' ')) old++
    if (line.startsWith('+') || line.startsWith(' ')) next++
  }
  return null
}
