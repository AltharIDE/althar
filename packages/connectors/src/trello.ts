import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import {
  cantChange,
  cantFind,
  type Account,
  type Choice,
  type Container,
  fieldsOf,
  type Issue,
  type IssueChange,
  type IssueComment,
  type IssueField,
  issueMatches,
  type IssueQuery,
  inIssueState,
  leftAsItIs,
  pageAt,
  type Person,
  type StatusCategory,
  type Tracker,
  type TrackerCapabilities,
  unfindable,
  unstarted,
} from './model'
import { answered, failedOf, probe, readAs, stopped, UNREADABLE, UNSAID } from './probe'

/*
 * Trello, a tracker, over its REST API. A card goes by its short link (the
 * `c/<shortLink>` of its address), which the API takes as well as its id,
 * and which is its key: a card's number is only its board's, and `#12` names
 * a repository's issue everywhere else. A card's status is its list; it has
 * no priority. Its description is Markdown already. The person's API key and
 * the token made for it go in a header, never in a URL. A due date is a
 * moment on Trello, shown in each reader's own zone, and a day here: a day
 * set goes as noon UTC, the same day from UTC−12 to UTC+11, and one read is
 * its day in UTC.
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
  due: Schema.optional(Schema.NullOr(Schema.String)),
  dueComplete: Schema.optional(Schema.Boolean),
  labels: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.optional(Schema.NullOr(Schema.String)) }))),
  idBoard: Schema.String,
  idList: Schema.String,
  members: Schema.optional(Schema.Array(Member)),
})
type Card = typeof Card.Type

/** What Althar reads of a card, and of its people, wherever it reads one. */
const CARD_FIELDS = 'name,desc,url,shortLink,dateLastActivity,closed,due,dueComplete,labels,idBoard,idList'
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
 * A list a card moves to as its work starts: one named for work under way
 * now, not one for review, testing or what is blocked, which also read as
 * started.
 */
const underWay = (list: List): boolean =>
  list.closed !== true && categoryOf(list.name) === 'started' && /\b(doing|in[ -]progress)\b/i.test(list.name)

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

/** The day a card is due, in UTC; null where it has no due date, or one that isn't a moment. */
const dayOf = (due: string | null | undefined): string | null =>
  due == null || Number.isNaN(Date.parse(due)) ? null : new Date(due).toISOString().slice(0, 10)

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
  due: dayOf(card.due),
})

/** The status a search narrows to by a list's name: the one name asked, alone; any other narrowing of status is Althar's, after. */
const oneList = (status: IssueQuery['status']): string | undefined =>
  status !== undefined && status.names.length === 1 && status.categories.length === 0 ? status.names[0]?.trim() || undefined : undefined

/**
 * What Trello's search is asked for a query, of open cards or archived ones:
 * its words, a label operator for each label, a list operator where one
 * status name alone is asked, and the account's cards where only they are.
 * A name goes in quotes, its own quotes dropped.
 */
export const searchQuery = (query: Pick<IssueQuery, 'text' | 'labels' | 'status' | 'mine'>, archive: 'open' | 'archived'): string => {
  const quoted = (operator: string, name: string) => `${operator}:"${name.replaceAll('"', '').trim()}"`
  const list = oneList(query.status)
  return [
    ...(query.text ?? '').split(/\s+/).filter((word) => word !== ''),
    ...(query.labels ?? []).filter((label) => label.trim() !== '').map((label) => quoted('label', label)),
    ...(list === undefined ? [] : [quoted('list', list)]),
    `is:${archive}`,
    ...(query.mine === true ? ['member:me'] : []),
  ].join(' ')
}

/** Whether Trello's search has something to narrow by: words, a label, or a list's name. */
const searchable = (query: IssueQuery): boolean =>
  (query.text ?? '').trim() !== '' || (query.labels ?? []).some((label) => label.trim() !== '') || oneList(query.status) !== undefined

/** The most cards Trello's search gives at once. */
const SEARCHED = 1000

/** The account, with its cards and its boards' lists, in one call. */
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
  due: Card.fields.due,
})

/** What Trello answers a search with: cards, each with its list and board. */
const Found = Schema.Struct({ cards: Schema.Array(Schema.Struct({ ...Card.fields, list: List, board: Board })) })

/** A comment on a card, as Trello lists its actions: who wrote it, its words, and when. */
const CommentAction = Schema.Struct({
  date: Schema.String,
  data: Schema.Struct({ text: Schema.optional(Schema.String) }),
  memberCreator: Schema.optional(Schema.NullOr(Member)),
})

/** What Trello changes of a card: its list, its archive, its people, labels, due day, name and description. */
const CHANGES = ['status', 'close', 'assignee', 'labels', 'due', 'title', 'description'] as const satisfies ReadonlyArray<IssueField>
type Unchanged = Exclude<IssueField, (typeof CHANGES)[number]>

/** Why a card hasn't each field Trello can't change, in words an agent can pass on. */
const HASNT: Record<Unchanged, string> = {
  priority: 'a Trello card has no priority',
  project: 'a card’s project is its board',
  milestone: 'a Trello card has no milestone',
  cycle: 'a Trello card has no cycle',
  parent: 'a Trello card isn’t part of another card',
  estimate: 'a Trello card has no estimate',
  type: 'a Trello card has no type',
  components: 'a Trello card has no components',
}

/** A field a card hasn't. */
const unchanged = (field: IssueField): field is Unchanged => field in HASNT

/** Trello files a card with its people and due date as well as its name, description and labels. */
export const TRELLO_TRACKING: TrackerCapabilities = {
  links: true,
  starts: true,
  changes: CHANGES,
  creates: ['assignee', 'due'],
  assignees: 'many',
  // Its search takes words, labels and a list's name; what it can't narrow by, Althar does with the cards it gives; cards by key are read one by one. A card has no priority, project, milestone, cycle or parent.
  finds: { text: 'search', labels: 'search', status: 'after', assignee: 'after', updatedSince: 'after', keys: 'search' },
}
const CAPABILITIES = TRELLO_TRACKING

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

  /** A day as Trello takes a due date: noon UTC, so it is the same day nearly everywhere it is read. */
  const dueAt = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && dayOf(`${day}T12:00:00.000Z`) === day
      ? Effect.succeed(`${day}T12:00:00.000Z`)
      : Effect.fail(new ConnectorFailed({ product, reason: 'rejected', message: `Not a day: ${day}` }))

  /** A card, and the id of the list it is on. */
  const readCard = (ref: string) =>
    Effect.flatMap(named(ref, 'card'), (card) =>
      Effect.map(
        call(
          Schema.Struct({ ...Card.fields, list: List, board: Board }),
          'GET',
          `${api}/cards/${card}?fields=${CARD_FIELDS}&members=true&member_fields=${MEMBER_FIELDS}&list=true&board=true&board_fields=name,closed`,
        ),
        (found) => ({ issue: issueOf(found, found.list, found.board), list: found.idList }),
      ),
    )
  const read = (ref: string) => Effect.map(readCard(ref), (found) => found.issue)

  /** The board a card is on, by its id. */
  const boardOf = (issue: Issue) =>
    Effect.gen(function* () {
      const card = yield* named(issue.id, 'card')
      const { idBoard } = yield* call(Schema.Struct({ idBoard: Schema.String }), 'GET', `${api}/cards/${card}?fields=idBoard`)
      return { card, board: yield* named(idBoard, 'board') }
    })

  /** What a field of a card on a board can be set to: Trello's choices are its board's. */
  const choicesOn = (board: string, field: 'status' | 'labels' | 'assignee') =>
    Effect.gen(function* () {
      switch (field) {
        // A card's status is its list: its board's open lists, left to right.
        case 'status':
          return (yield* call(Schema.Array(List), 'GET', `${api}/boards/${board}/lists?filter=open&fields=name,closed`)).map(
            (list): Choice => ({ id: list.id, name: list.name }),
          )
        // Its board's labels with a name; one with only a colour has none to find it by.
        case 'labels':
          return (yield* call(BoardLabels, 'GET', `${api}/boards/${board}/labels?fields=name&limit=1000`)).flatMap(
            (label): ReadonlyArray<Choice> => (label.name == null || label.name.trim() === '' ? [] : [{ id: label.id, name: label.name }]),
          )
        // Its board's people, who can be put on the card.
        case 'assignee':
          return (yield* call(Schema.Array(Member), 'GET', `${api}/boards/${board}/members?fields=${MEMBER_FIELDS}`)).map(
            (member): Choice => ({ id: member.id, name: member.fullName ?? member.username, also: [member.username] }),
          )
      }
    })

  const choices: Tracker['choices'] = (issue, field) =>
    Effect.gen(function* () {
      if (unchanged(field)) return yield* cantChange(product, field, HASNT[field])
      const { board } = yield* boardOf(issue)
      return yield* choicesOn(board, field)
    })

  // A card filed on a list is on the list's board, and has its board's choices.
  const choicesIn: Tracker['choicesIn'] = (container, field) =>
    Effect.gen(function* () {
      if (unchanged(field)) return yield* cantChange(product, field, HASNT[field])
      const list = yield* named(container, 'list')
      const { idBoard } = yield* call(Schema.Struct({ idBoard: Schema.String }), 'GET', `${api}/lists/${list}?fields=idBoard`)
      return yield* choicesOn(yield* named(idBoard, 'board'), field)
    })

  /** The ids of the people a change puts on a card, and takes off it, checked before anything is asked. */
  const membersOf = (change: IssueChange['assignee']) =>
    Effect.all({
      add: Effect.forEach(change?.add ?? [], (member) => named(member.id, 'member')),
      remove: Effect.forEach(change?.remove ?? [], (member) => named(member.id, 'member')),
    })

  const changeIssue: Tracker['update'] = (issue, wanted) =>
    Effect.gen(function* () {
      const refused = fieldsOf(wanted).find(unchanged)
      if (refused !== undefined) return yield* cantChange(product, refused, HASNT[refused])
      const card = yield* named(issue.id, 'card')
      const list = wanted.status === undefined ? undefined : yield* named(wanted.status.id, 'list')
      const members = yield* membersOf(wanted.assignee)
      const due = wanted.due === undefined || wanted.due === null ? wanted.due : yield* dueAt(wanted.due)
      // Its title, description, list and due date, everyone taken off, and archived to close it, in one edit.
      const edit = {
        ...(wanted.title === undefined ? {} : { name: wanted.title }),
        ...(wanted.description === undefined ? {} : { desc: wanted.description }),
        ...(list === undefined ? {} : { idList: list }),
        ...(due === undefined ? {} : { due }),
        ...(wanted.assignee === null ? { idMembers: '' } : {}),
        ...(wanted.close === true ? { closed: true } : {}),
      }
      if (Object.keys(edit).length > 0) yield* call(Schema.Unknown, 'PUT', `${api}/cards/${card}`, edit)
      // A person or a label is added and taken off by its id, leaving the others; one already on, or already off, Trello refuses, and nothing changes.
      const settled = (effect: Effect.Effect<unknown, ConnectorFailed>) =>
        Effect.catchIf(
          effect,
          (error) => error.reason === 'rejected' && /already|not found|not on|isn['’]?t/i.test(error.message),
          () => Effect.void,
        )
      for (const member of members.add)
        if (!issue.assignees.some((had) => had.id === member))
          yield* settled(call(Schema.Unknown, 'POST', `${api}/cards/${card}/idMembers`, { value: member }))
      for (const member of members.remove) yield* settled(call(Schema.Unknown, 'DELETE', `${api}/cards/${card}/idMembers/${member}`))
      for (const label of wanted.labels?.add ?? [])
        if (!issue.labels.some((had) => had.toLowerCase() === label.name.toLowerCase()))
          yield* settled(call(Schema.Unknown, 'POST', `${api}/cards/${card}/idLabels`, { value: yield* named(label.id, 'label') }))
      for (const label of wanted.labels?.remove ?? [])
        yield* settled(call(Schema.Unknown, 'DELETE', `${api}/cards/${card}/idLabels/${yield* named(label.id, 'label')}`))
      return yield* read(card)
    })

  /**
   * The cards the account is on, each on its list and board: those not
   * archived, on open boards, or all of them, archived boards' too.
   */
  const memberCards = (filter: 'open' | 'all') =>
    Effect.map(
      call(
        Mine,
        'GET',
        `${api}/members/me?fields=id&cards=${filter}&card_fields=${CARD_FIELDS}&card_members=true&card_member_fields=${MEMBER_FIELDS}&boards=${filter}&board_fields=name,closed&board_lists=all`,
      ),
      ({ cards, boards }) => {
        const byId = new Map(boards.map((board) => [board.id, board]))
        return cards.flatMap((card) => {
          const board = byId.get(card.idBoard)
          const list = board?.lists.find((candidate) => candidate.id === card.idList)
          return board === undefined || list === undefined ? [] : [issueOf(card, list, board)]
        })
      },
    )

  /**
   * Every card on the boards the account can see, anyone's or no one's, each
   * on its list and board: those not archived, on open boards, or all of
   * them. One call for the boards and their lists, then one for each board.
   */
  const boardCards = (filter: 'open' | 'all') =>
    Effect.gen(function* () {
      const boards = yield* call(
        Schema.Array(Schema.Struct({ ...Board.fields, lists: Schema.Array(List) })),
        'GET',
        `${api}/members/me/boards?filter=${filter}&fields=name,closed&lists=all`,
      )
      const cards = yield* Effect.forEach(
        boards,
        (board) =>
          Effect.gen(function* () {
            const onBoard = yield* call(
              Schema.Array(Card),
              'GET',
              `${api}/boards/${yield* named(board.id, 'board')}/cards/${filter}?fields=${CARD_FIELDS}&members=true&member_fields=${MEMBER_FIELDS}`,
            )
            return onBoard.flatMap((card) => {
              const list = board.lists.find((candidate) => candidate.id === card.idList)
              return list === undefined ? [] : [issueOf(card, list, board)]
            })
          }),
        { concurrency: 4 },
      )
      return cards.flat()
    })

  /** A list's cards, on it and its board: those not archived, or all of them. */
  const listCards = (container: string, filter: 'open' | 'all') =>
    Effect.gen(function* () {
      const list = yield* named(container, 'list')
      const cards = yield* call(
        Schema.Array(Card),
        'GET',
        `${api}/lists/${list}/cards?filter=${filter}&fields=${CARD_FIELDS}&members=true&member_fields=${MEMBER_FIELDS}`,
      )
      const onList = yield* call(
        Schema.Struct({ ...List.fields, idBoard: Schema.String }),
        'GET',
        `${api}/lists/${list}?fields=name,closed,idBoard`,
      )
      const board = yield* call(Board, 'GET', `${api}/boards/${yield* named(onList.idBoard, 'board')}?fields=name,closed`)
      return cards.map((card) => issueOf(card, onList, board))
    })

  /**
   * Cards Trello's search finds, as `searchQuery` asks for them, to the most
   * it gives. It leaves archived cards out unless asked for them alone, so
   * closed and all ask twice: a card done is often in a Done list, not archived.
   */
  const searchCards = (query: IssueQuery) =>
    Effect.gen(function* () {
      const asked = yield* Effect.forEach(query.state === 'open' ? (['open'] as const) : (['open', 'archived'] as const), (archive) =>
        call(
          Found,
          'GET',
          `${api}/search?query=${encodeURIComponent(searchQuery(query, archive))}&modelTypes=cards&cards_limit=${SEARCHED}&card_fields=${CARD_FIELDS}&card_board=true&card_list=true&card_members=true`,
        ),
      )
      const byId = new Map(asked.flatMap(({ cards }) => cards).map((card) => [card.id, issueOf(card, card.list, card.board)]))
      return [...byId.values()]
    })

  /** The cards keys name, each read by its short link, on a list where one is asked: a key no card has is left out. */
  const keyedCards = (keys: ReadonlyArray<string>, container: string | undefined) =>
    Effect.map(
      Effect.forEach(
        [...new Set(keys.map((key) => key.trim()).filter((key) => key !== ''))],
        (key) =>
          Effect.catchIf(
            readCard(key),
            (error) => error.reason === 'not_found',
            () => Effect.succeed(undefined),
          ),
        { concurrency: 4 },
      ),
      (cards) => {
        const byId = new Map<string, Issue>()
        for (const card of cards)
          if (card !== undefined && (container === undefined || card.list === container)) byId.set(card.issue.id, card.issue)
        return [...byId.values()]
      },
    )

  /**
   * Cards by key; else a list's; else those Trello's search finds by words,
   * labels or a list's name; else the account's own where only those are
   * asked, or every card on its boards. What Trello can't narrow by, Althar
   * does (`issueMatches`), and pages through them by offset.
   */
  const find: Tracker['find'] = (query) =>
    Effect.gen(function* () {
      const refused = unfindable(CAPABILITIES, query)
      if (refused.length > 0) return yield* cantFind(product, `A Trello card has no ${refused.join(' or ')} to find it by`)
      const filter = query.state === 'open' ? 'open' : 'all'
      const keyed = (query.keys ?? []).length > 0
      const issues = keyed
        ? yield* keyedCards(query.keys ?? [], query.container)
        : query.container !== undefined
          ? yield* listCards(query.container, filter)
          : searchable(query)
            ? yield* searchCards(query)
            : query.mine === true
              ? yield* memberCards(filter)
              : yield* boardCards(filter)
      // Only the account's where asked: Trello's search, and the account's own cards, keep to them already; cards by key or on a list don't.
      const me = query.mine === true && (keyed || query.container !== undefined) ? yield* account : undefined
      return pageAt(
        issues.filter((issue) => issueMatches(issue, query, me)),
        query,
      )
    })

  return {
    product,
    capabilities: CAPABILITIES,
    account,
    issue: read,
    // The cards the account is on, not archived, on an open board; those done or cancelled left out, as other trackers' are.
    mine: (options = {}) =>
      Effect.map(
        memberCards('open'),
        (issues) =>
          pageAt(
            issues.filter(
              (issue) =>
                inIssueState('open', issue.status.category) && (options.container === undefined || issue.container === options.container),
            ),
            { limit: options.limit ?? 50 },
          ).issues,
      ),
    find,
    // Trello lists a card's comments newest first, as actions on it.
    comments: (issue, limit) =>
      Effect.gen(function* () {
        if (limit < 1) return []
        const card = yield* named(issue.id, 'card')
        const actions = yield* call(
          Schema.Array(CommentAction),
          'GET',
          `${api}/cards/${card}/actions?filter=commentCard&limit=${Math.min(limit, 1000)}&fields=data,date&memberCreator=true&memberCreator_fields=${MEMBER_FIELDS}`,
        )
        return actions.toReversed().map((action): IssueComment => ({
          author: action.memberCreator == null ? null : personOf(action.memberCreator),
          body: action.data.text ?? '',
          at: action.date,
        }))
      }),
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
    // A card's status is its list: one still to do goes to the top of its board's first open list named for work under way, as a person would drag it.
    start: (issue) =>
      Effect.gen(function* () {
        if (!unstarted(issue.status.category)) return leftAsItIs(issue)
        const card = yield* named(issue.id, 'card')
        const { idBoard } = yield* call(Schema.Struct({ idBoard: Schema.String }), 'GET', `${api}/cards/${card}?fields=idBoard`)
        const board = yield* named(idBoard, 'board')
        // Trello lists a board's lists in their order on it, left to right.
        const lists = yield* call(Schema.Array(List), 'GET', `${api}/boards/${board}/lists?filter=open&fields=name,closed`)
        const into = lists.find(underWay)
        if (into === undefined)
          return yield* new ConnectorFailed({ product, reason: 'rejected', message: 'Its board has no list named Doing or In progress' })
        yield* call(Schema.Unknown, 'PUT', `${api}/cards/${card}`, { idList: into.id, pos: 'top' })
        return { moved: true, status: { name: into.name, category: 'started' } }
      }),
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
        // What else it is filed with is checked before anything is asked: only its people and due date go with it.
        const fields = draft.fields ?? {}
        const refused = fieldsOf(fields).find((field) => !CAPABILITIES.creates.includes(field))
        if (refused !== undefined)
          return yield* unchanged(refused)
            ? cantChange(product, refused, HASNT[refused])
            : new ConnectorFailed({ product, reason: 'rejected', message: `Trello files a card without its ${refused}: it is set after` })
        const members = yield* membersOf(fields.assignee)
        const due = fields.due == null ? undefined : yield* dueAt(fields.due)
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
          ...(members.add.length === 0 ? {} : { idMembers: members.add.join(',') }),
          ...(due === undefined ? {} : { due }),
        })
        // Filed: a failed read of it now is no reason to file it again, so it is as Trello answered the filing.
        const now = yield* Clock.currentTimeMillis
        return yield* read(card.shortLink).pipe(
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
            due: dayOf(card.due),
          })),
        )
      }),
    choices,
    choicesIn,
    update: changeIssue,
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
