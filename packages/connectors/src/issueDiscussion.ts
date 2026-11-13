import { Effect, Option, Schema } from 'effect'

import type { ApiRequest, ServiceApi } from './api'
import { ConnectorFailed } from './errors'
import { adfOf, AdfNode, markdownOfAdf, wikiOf } from './jiraText'
import type { Product } from './model'

const Record = Schema.Record(Schema.String, Schema.Unknown)
const Records = Schema.Array(Record)
const Page = Schema.Struct({
  nodes: Records,
  pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
})
const decode = <S extends Schema.Top>(product: Product, schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      () => new ConnectorFailed({ product, reason: 'invalid_response', message: 'The service returned an invalid discussion page.' }),
    ),
  )
const fail = (product: Product, message: string) => new ConnectorFailed({ product, reason: 'rejected', message })
const numberPage = (product: Product, cursor: string | undefined, first: number) => {
  const page = cursor === undefined ? first : Number(cursor)
  return Number.isSafeInteger(page) && page >= first ? Effect.succeed(page) : Effect.fail(fail(product, 'Invalid discussion cursor.'))
}

/** The service's comments, unabridged, with IDs and an explicit continuation. */
export const readIssueDiscussion = (
  product: Product,
  api: ServiceApi,
  issue: { readonly id: string; readonly ref: string },
  options: { readonly cursor?: string | undefined; readonly limit?: number | undefined } = {},
): Effect.Effect<{ readonly comments: ReadonlyArray<Readonly<Record<string, unknown>>>; readonly next: string | null }, ConnectorFailed> =>
  Effect.gen(function* () {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    if (product === 'linear') {
      const answer = yield* api.request({
        query:
          'query($id: String!, $first: Int!, $after: String) { issue(id: $id) { comments(first: $first, after: $after, orderBy: createdAt) { nodes { id body createdAt updatedAt url user { id name displayName } parent { id } } pageInfo { hasNextPage endCursor } } } }',
        variables: { id: issue.id, first: limit, after: options.cursor ?? null },
      })
      const parsed = yield* decode(product, Schema.Struct({ issue: Schema.Struct({ comments: Page }) }), answer.body)
      if (
        parsed.issue.comments.pageInfo.hasNextPage &&
        (parsed.issue.comments.pageInfo.endCursor === null || parsed.issue.comments.pageInfo.endCursor === options.cursor)
      )
        return yield* new ConnectorFailed({
          product,
          reason: 'invalid_response',
          message: 'The discussion has more comments but its continuation did not advance.',
        })
      return {
        comments: parsed.issue.comments.nodes,
        next: parsed.issue.comments.pageInfo.hasNextPage ? parsed.issue.comments.pageInfo.endCursor : null,
      }
    }
    if (product === 'github' || product === 'gitlab') {
      const match = /^(.+)#(\d+)$/.exec(issue.ref)
      const repository = match?.[1]
      const number = match?.[2]
      if (repository === undefined || number === undefined)
        return yield* fail(product, 'An issue reference needs its repository and number.')
      const page = yield* numberPage(product, options.cursor, 1)
      const path =
        product === 'github'
          ? `/repos/${repository}/issues/${number}/comments?per_page=${limit}&page=${page}`
          : `/projects/${encodeURIComponent(repository)}/issues/${number}/discussions?per_page=${limit}&page=${page}`
      const answer = yield* api.request({ path })
      if (product === 'gitlab') {
        const discussions = yield* decode(
          product,
          Schema.Array(Schema.Struct({ id: Schema.String, individual_note: Schema.Boolean, notes: Records })),
          answer.body,
        )
        return {
          comments: discussions.flatMap((thread) =>
            thread.notes.map((note) => ({ ...note, threadId: thread.individual_note ? null : thread.id })),
          ),
          next: answer.next !== null || discussions.length === limit ? String(page + 1) : null,
        }
      }
      const comments = yield* decode(product, Records, answer.body)
      return { comments, next: answer.next !== null || comments.length === limit ? String(page + 1) : null }
    }
    if (product === 'jira_cloud' || product === 'jira_dc') {
      const start = yield* numberPage(product, options.cursor, 0)
      const answer = yield* api.request({
        path: `/issue/${encodeURIComponent(issue.ref)}/comment?orderBy=created&startAt=${start}&maxResults=${limit}`,
      })
      const page = yield* decode(product, Schema.Struct({ comments: Records, startAt: Schema.Number, total: Schema.Number }), answer.body)
      if (page.comments.length === 0 && page.startAt < page.total)
        return yield* new ConnectorFailed({
          product,
          reason: 'invalid_response',
          message: 'Jira returned an empty discussion page before its reported end.',
        })
      return {
        comments: page.comments.map((comment) => {
          const adf = product === 'jira_cloud' ? Option.getOrNull(Schema.decodeUnknownOption(AdfNode)(comment['body'])) : null
          return { ...comment, ...(adf === null ? {} : { body: markdownOfAdf(adf) }) }
        }),
        next: page.startAt + page.comments.length < page.total ? String(page.startAt + page.comments.length) : null,
      }
    }
    if (product === 'trello') {
      const answer = yield* api.request({
        path: `/cards/${encodeURIComponent(issue.id)}/actions?filter=commentCard&limit=${limit}&memberCreator=true${options.cursor === undefined ? '' : `&before=${encodeURIComponent(options.cursor)}`}`,
      })
      const comments = yield* decode(product, Records, answer.body)
      const last = comments.at(-1)?.['id']
      return { comments, next: comments.length === limit && typeof last === 'string' ? last : null }
    }
    return yield* fail(product, 'This connection has no issue discussion API.')
  })

/** Editing addresses a stable comment ID; replies use Linear's root comment or GitLab's discussion ID. */
export const issueCommentRequest = (
  product: Product,
  issue: { readonly id: string; readonly ref: string },
  body: string,
  options: { readonly id?: string; readonly parent?: string } = {},
): Effect.Effect<ApiRequest, ConnectorFailed> =>
  Effect.gen(function* () {
    if (product === 'linear')
      return options.id === undefined
        ? {
            query:
              'mutation($input: CommentCreateInput!) { result: commentCreate(input: $input) { success comment { id body url parent { id } } } }',
            variables: { input: { issueId: issue.id, body, ...(options.parent === undefined ? {} : { parentId: options.parent }) } },
          }
        : {
            query:
              'mutation($id: String!, $input: CommentUpdateInput!) { result: commentUpdate(id: $id, input: $input) { success comment { id body url } } }',
            variables: { id: options.id, input: { body } },
          }
    if (product === 'gitlab' && options.parent !== undefined) {
      const [repository = '', number = ''] = issue.ref.split('#')
      return {
        method: 'POST',
        path: `/projects/${encodeURIComponent(repository)}/issues/${number}/discussions/${encodeURIComponent(options.parent)}/notes`,
        body: { body },
      }
    }
    if (options.parent !== undefined)
      return yield* fail(product, 'This tracker does not have native threaded issue comments; use comment_on_issue.')
    const id = options.id
    if (id === undefined) return yield* fail(product, 'Name the comment to edit by its ID.')
    if (product === 'github' || product === 'gitlab') {
      const [repository = '', number = ''] = issue.ref.split('#')
      return {
        method: product === 'github' ? 'PATCH' : 'PUT',
        path:
          product === 'github'
            ? `/repos/${repository}/issues/comments/${encodeURIComponent(id)}`
            : `/projects/${encodeURIComponent(repository)}/issues/${number}/notes/${encodeURIComponent(id)}`,
        body: { body },
      }
    }
    if (product === 'jira_cloud' || product === 'jira_dc')
      return {
        method: 'PUT',
        path: `/issue/${encodeURIComponent(issue.ref)}/comment/${encodeURIComponent(id)}`,
        body: { body: product === 'jira_cloud' ? adfOf(body) : wikiOf(body) },
      }
    if (product === 'trello')
      return {
        method: 'PUT',
        path: `/cards/${encodeURIComponent(issue.id)}/actions/${encodeURIComponent(id)}/comments`,
        body: { text: body },
      }
    return yield* fail(product, 'This connection has no issue comment API.')
  })
