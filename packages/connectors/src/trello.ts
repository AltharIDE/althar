import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import type { Account, Issue, Person, StatusCategory, Tracker } from './model'

/*
 * Trello, a tracker, over its REST API. A card goes by its short link (the
 * `c/<shortLink>` of its address), which the API takes as well as its id,
 * and which is its key: a card's number is only its board's, and `#12` names
 * a repository's issue everywhere else. A card's status is its list; it has
 * no priority. Its description is Markdown already. The person's API key and
 * the token made for it go in a header, never in a URL.
 */

const Member = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  fullName: Schema.optional(Schema.NullOr(Schema.String)),
})
type Member = typeof Member.Type

const List = Schema.Struct({ id: Schema.String, name: Schema.String, closed: Schema.optional(Schema.Boolean) })
type List = typeof List.Type

const Board = Schema.Struct({ id: Schema.String, name: Schema.String, closed: Schema.optional(Schema.Boolean) })
type Board = typeof Board.Type

const Card = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  desc: Schema.optional(Schema.String),
  url: Schema.String,
  shortLink: Schema.String,
  dateLastActivity: Schema.String,
  closed: Schema.Boolean,
  dueComplete: Schema.optional(Schema.Boolean),
  labels: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }))),
  idBoard: Schema.String,
  idList: Schema.String,
  members: Schema.optional(Schema.Array(Member)),
})
type Card = typeof Card.Type

/** What Althar reads of a card, and of its people, wherever it reads one. */
const CARD_FIELDS = 'name,desc,url,shortLink,dateLastActivity,closed,dueComplete,labels,idBoard,idList'
const MEMBER_FIELDS = 'fullName,username'

/**
 * A list's name as a category. A board's lists are its people's own, so
 * this reads the usual names and calls anything else to do. Order matters:
 * "Won't do" is cancelled, "Not done" to do, and "Review done" done.
 */
export const categoryOf = (list: string): StatusCategory => {
  const name = list.toLowerCase()
  if (/\b(cancell?ed|won['’]?t do|dropped|rejected)\b/.test(name)) return 'cancelled'
  if (/\b(not|un)\s*done\b/.test(name)) return 'todo'
  if (/\b(done|complete|completed|finished|shipped)\b/.test(name)) return 'done'
  if (/\b(doing|in[ -]progress|review|qa|testing|blocked)\b/.test(name)) return 'started'
  if (/\b(backlog|icebox)\b/.test(name)) return 'backlog'
  return 'todo'
}

/**
 * Trello says why it refused in plain words, and its statuses don't always
 * match them: a token it won't take can come as a 400, and a 401 can mean
 * only that this account may not see or change the card. Only the first is
 * a sign-in to do again.
 */
export const classified = (error: ConnectorFailed): ConnectorFailed => {
  const reason = /^(invalid|expired) (token|key)$/i.test(error.message)
    ? 'unauthorized'
    : error.reason === 'unauthorized' && /permission|read-only/i.test(error.message)
      ? 'forbidden'
      : error.reason
  return reason === error.reason
    ? error
    : new ConnectorFailed({
        product: error.product,
        reason,
        message: error.message,
        ...(error.status === undefined ? {} : { status: error.status }),
      })
}

const personOf = (member: Member): Person => ({ id: member.id, login: member.username, name: member.fullName ?? null, bot: false })

/**
 * A card's category. Archived (the card, its list or its board), it is done.
 * A ticked due date is only a hint, since some tick a milestone on a card
 * still under way: it says done only where the list's name says to do.
 */
const cardCategory = (card: Card, list: List, board: Board): StatusCategory => {
  if (card.closed || list.closed === true || board.closed === true) return 'done'
  const named = categoryOf(list.name)
  return named === 'todo' && card.dueComplete === true ? 'done' : named
}

/** A card, on its list and board. */
const issueOf = (card: Card, list: List, board: Board): Issue => ({
  id: card.id,
  ref: card.shortLink,
  key: card.shortLink,
  title: card.name,
  body: card.desc ?? '',
  url: card.url,
  status: { name: list.name, category: cardCategory(card, list, board) },
  priority: null,
  assignees: (card.members ?? []).map(personOf),
  // A label with only a colour has no words to show.
  labels: (card.labels ?? []).flatMap((label) => (label.name == null || label.name === '' ? [] : [label.name])),
  container: board.name,
  updatedAt: card.dateLastActivity,
})

/** The account, with its open cards and every open board's lists, in one call. */
const Mine = Schema.Struct({
  cards: Schema.Array(Card),
  boards: Schema.Array(Schema.Struct({ ...Board.fields, lists: Schema.Array(List) })),
})

export const makeTrello = (options: AdapterOptions): Tracker => {
  const product = 'trello' as const
  const api = options.apiUrl.replace(/\/+$/, '')
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })
  const call = <A>(schema: Schema.Codec<A, unknown>, method: string, url: string, body?: unknown) =>
    Effect.mapError(http.json(schema, method, url, body), classified)

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(
    call(Member, 'GET', `${api}/members/me?fields=id,username,fullName`),
    (member) => ({ id: member.id, login: member.username, name: member.fullName ?? null }),
  )

  return {
    product,
    capabilities: { links: true },
    account,
    issue: (ref) =>
      /^[A-Za-z0-9]+$/.test(ref)
        ? Effect.map(
            call(
              Schema.Struct({ ...Card.fields, list: List, board: Board }),
              'GET',
              `${api}/cards/${ref}?fields=${CARD_FIELDS}&members=true&member_fields=${MEMBER_FIELDS}&list=true&board=true&board_fields=name,closed`,
            ),
            (card) => issueOf(card, card.list, card.board),
          )
        : Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a Trello card: ${ref}` })),
    // The cards the account is on, not archived, on an open board; those done or cancelled left out, as other trackers' are.
    mine: (options = {}) =>
      Effect.map(
        call(
          Mine,
          'GET',
          `${api}/members/me?fields=id&cards=open&card_fields=${CARD_FIELDS}&card_members=true&card_member_fields=${MEMBER_FIELDS}&boards=open&board_fields=name&board_lists=all`,
        ),
        ({ cards, boards }) => {
          const byId = new Map(boards.map((board) => [board.id, board]))
          return cards
            .flatMap((card) => {
              const board = byId.get(card.idBoard)
              const list = board?.lists.find((candidate) => candidate.id === card.idList)
              return board === undefined || list === undefined ? [] : [issueOf(card, list, board)]
            })
            .filter(
              (issue) =>
                issue.status.category !== 'done' &&
                issue.status.category !== 'cancelled' &&
                (options.container === undefined || issue.container === options.container),
            )
            .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .slice(0, options.limit ?? 50)
        },
      ),
    comment: (issue, body) => Effect.asVoid(call(Schema.Unknown, 'POST', `${api}/cards/${issue.id}/actions/comments`, { text: body })),
    link: (issue, link) =>
      Effect.gen(function* () {
        // Trello attaches a link as often as it is asked: one already there is left as it is.
        const attached = yield* call(
          Schema.Array(Schema.Struct({ url: Schema.optional(Schema.NullOr(Schema.String)) })),
          'GET',
          `${api}/cards/${issue.id}/attachments?fields=url`,
        )
        if (attached.some((attachment) => attachment.url === link.url)) return
        yield* call(Schema.Unknown, 'POST', `${api}/cards/${issue.id}/attachments`, { url: link.url, name: link.title })
      }),
  }
}
