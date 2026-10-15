import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import { type Account, type Container, type Issue, leftAsItIs, type Person, type StatusCategory, type Tracker } from './model'
import { answered, failedOf, probe, readAs, stopped, UNREADABLE, UNSAID } from './probe'

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

/** A card's labels by name: one with only a colour has no words to show. */
const labelsOf = (labels: Card['labels']): ReadonlyArray<string> =>
  (labels ?? []).flatMap((label) => (label.name == null || label.name === '' ? [] : [label.name]))

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
  labels: labelsOf(card.labels),
  container: board.name,
  updatedAt: card.dateLastActivity,
})

/** The account, with its open cards and every open board's lists, in one call. */
const Mine = Schema.Struct({
  cards: Schema.Array(Card),
  boards: Schema.Array(Schema.Struct({ ...Board.fields, lists: Schema.Array(List) })),
})

/** A board's labels; one with only a colour has no name to match. */
const BoardLabels = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.NullOr(Schema.String)) }))

/** What Trello answers a filing with: the card, as it was made. */
const Created = Schema.Struct({
  id: Schema.String,
  shortLink: Schema.String,
  url: Schema.String,
  name: Schema.String,
  desc: Schema.optional(Schema.String),
  dateLastActivity: Schema.optional(Schema.String),
  labels: Card.fields.labels,
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

  /** Trello's ids and short links are letters and digits: anything else isn't one, and isn't put in a URL. */
  const named = (id: string, what: string) =>
    /^[A-Za-z0-9]+$/.test(id)
      ? Effect.succeed(id)
      : Effect.fail(new ConnectorFailed({ product, reason: 'not_found', message: `Not a Trello ${what}: ${id}` }))

  const issue = (ref: string) =>
    Effect.flatMap(named(ref, 'card'), (card) =>
      Effect.map(
        call(
          Schema.Struct({ ...Card.fields, list: List, board: Board }),
          'GET',
          `${api}/cards/${card}?fields=${CARD_FIELDS}&members=true&member_fields=${MEMBER_FIELDS}&list=true&board=true&board_fields=name,closed`,
        ),
        (found) => issueOf(found, found.list, found.board),
      ),
    )

  return {
    product,
    capabilities: { links: true, starts: false },
    account,
    issue,
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
    // A card's status is its list, named as each board likes: which list is "in progress" would be a guess, so a card stays where it is.
    start: (issue) => Effect.succeed(leftAsItIs(issue)),
    // A list is where a card is filed: every open list on the account's open boards, named with its board. Trello lists every board in one answer, unpaged.
    containers: () =>
      Effect.map(
        call(
          Schema.Array(Schema.Struct({ ...Board.fields, lists: Schema.Array(List) })),
          'GET',
          `${api}/members/me/boards?filter=open&fields=name&lists=open`,
        ),
        (boards) =>
          boards.flatMap((board) =>
            board.lists
              .filter((list) => list.closed !== true)
              .map((list): Container => ({ id: list.id, key: null, name: `${board.name} / ${list.name}` })),
          ),
      ),
    create: (container, draft) =>
      Effect.gen(function* () {
        const list = yield* named(container, 'list')
        // A label belongs to a board, and a card takes it by id: the list's board's are read only when some are asked for.
        const wanted = new Set(draft.labels.map((label) => label.trim().toLowerCase()).filter((label) => label !== ''))
        const { onList, idLabels } =
          wanted.size === 0
            ? { onList: undefined, idLabels: [] }
            : yield* Effect.gen(function* () {
                const onList = yield* call(
                  Schema.Struct({ idBoard: Schema.String, name: Schema.String }),
                  'GET',
                  `${api}/lists/${list}?fields=idBoard,name`,
                )
                // A board's labels come fifty at a time unless asked for more; a thousand is the most Trello gives.
                const labels = yield* call(BoardLabels, 'GET', `${api}/boards/${onList.idBoard}/labels?fields=name&limit=1000`)
                // A board may have two labels of a name, in two colours: the first is the one.
                const byName = new Map<string, string>()
                for (const label of labels) {
                  const name = label.name?.trim().toLowerCase() ?? ''
                  if (wanted.has(name) && !byName.has(name)) byName.set(name, label.id)
                }
                return { onList, idLabels: [...byName.values()] }
              })
        const card = yield* call(Created, 'POST', `${api}/cards`, {
          idList: list,
          name: draft.title,
          desc: draft.body,
          ...(idLabels.length === 0 ? {} : { idLabels: idLabels.join(',') }),
        })
        // Filed: a failed read of it now is no reason to file it again, so it is as Trello answered the filing.
        const now = yield* Clock.currentTimeMillis
        return yield* issue(card.shortLink).pipe(
          Effect.orElseSucceed((): Issue => ({
            id: card.id,
            ref: card.shortLink,
            key: card.shortLink,
            title: card.name,
            body: card.desc ?? draft.body,
            url: card.url,
            status: onList === undefined ? { name: 'To do', category: 'todo' } : { name: onList.name, category: categoryOf(onList.name) },
            priority: null,
            assignees: [],
            labels: labelsOf(card.labels),
            container: null,
            updatedAt: card.dateLastActivity ?? new Date(now).toISOString(),
          })),
        )
      }),
  }
}

/*
 * What a Trello connection can do. A token is made for the person's own
 * Power-Up key, named Althar, and Trello lists a member's tokens with what
 * each may do: whether Althar's may write, and when it runs out, is read
 * there. Which of several named Althar is this one isn't said, so they are
 * read together.
 */

const Token = Schema.Struct({
  identifier: Schema.optional(Schema.NullOr(Schema.String)),
  dateCreated: Schema.optional(Schema.NullOr(Schema.String)),
  dateExpires: Schema.optional(Schema.NullOr(Schema.String)),
  permissions: Schema.optional(Schema.Array(Schema.Struct({ idModel: Schema.String, write: Schema.optional(Schema.Boolean) }))),
})

/** The name Althar's tokens are made with. */
const NAMED = 'Althar'

export const accessTrello: Access = (input) =>
  Effect.gen(function* () {
    const api = input.apiUrl.replace(/\/+$/, '')
    const ask = (url: string) => probe(input, url)
    const key = input.credential.kind === 'app' ? input.credential.key : null
    if (key === null) return stopped([line('key', 'no', { reason: { kind: 'failed', message: 'No API key' } })])
    const keyLine = line('key', 'ok', { fact: `····${key.slice(-4)}` })

    const me = yield* ask(`${api}/members/me?fields=id,username,fullName`)
    if (!answered(me)) {
      // Trello says what it didn't take in plain words, and a token it won't take can come as a 400.
      if (/^invalid key$/i.test(me.message)) return stopped([line('key', 'no', { fact: keyLine.fact, reason: failedOf(me) })])
      const refused = me.status === 401 || /^(invalid|expired) token$/i.test(me.message)
      return stopped([keyLine, line('account', 'no', { reason: refused ? { kind: 'refused' } : failedOf(me) })])
    }
    const member = readAs(Member, me)
    if (member === undefined) return stopped([keyLine, line('account', 'no', { reason: UNREADABLE })])

    const boards = yield* ask(`${api}/members/me/boards?fields=name&filter=open`)
    const open = answered(boards) ? readAs(Schema.Array(Board), boards) : undefined

    const tokens = yield* ask(`${api}/members/me/tokens?fields=identifier,dateCreated,dateExpires,permissions`)
    const listed = answered(tokens) ? readAs(Schema.Array(Token), tokens) : undefined
    const ours = listed?.filter((token) => token.identifier === NAMED)
    const writes = ours?.map(
      (token) => token.permissions?.some((permission) => permission.idModel === '*' && permission.write === true) === true,
    )
    const newest = ours?.reduce<typeof Token.Type | undefined>(
      (latest, token) => (latest === undefined || (token.dateCreated ?? '') >= (latest.dateCreated ?? '') ? token : latest),
      undefined,
    )
    const write = (need: 'comment' | 'move'): AccessLine => {
      if (answered(tokens) && listed === undefined) return line(need, 'no', { reason: UNREADABLE })
      // Refused, the list says nothing of what the token may write; anything else that went wrong is said.
      if (!answered(tokens) && tokens.status !== 401 && tokens.status !== 403) return line(need, 'no', { reason: failedOf(tokens) })
      if (writes === undefined || writes.length === 0 || writes.some((one) => one !== writes[0]))
        return line(need, 'unknown', { reason: UNSAID })
      return writes[0] === true ? line(need, 'ok') : line(need, 'no', { reason: { kind: 'scope', scope: 'write', url: null } })
    }

    return {
      account: { id: member.id, login: member.username, name: member.fullName ?? null },
      lines: [
        keyLine,
        line('account', 'ok', { fact: member.username }),
        open === undefined
          ? line('read', 'no', { reason: answered(boards) ? UNREADABLE : failedOf(boards) })
          : line('read', 'ok', { count: open.length }),
        write('comment'),
        write('move'),
      ],
      expiresAt: newest?.dateExpires ?? null,
      scopes: null,
    }
  })
