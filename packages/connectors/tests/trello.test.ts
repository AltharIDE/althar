import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { ConnectorFailed } from '../src/errors'
import type { Issue } from '../src/model'
import { categoryOf, classified, makeTrello } from '../src/trello'
import { type Route, stubFetch } from './stub'

/*
 * Trello against its own answers: those for public cards and a public member,
 * read anonymously from api.trello.com on 7 October 2026 and trimmed. What
 * Trello says to a write is from its API reference, since nothing here
 * writes to Trello.
 */

const API = 'https://api.trello.com/1'
const AUTHORIZATION = 'OAuth oauth_consumer_key="0123abcd", oauth_token="ATTA0000"'

const trello = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    tracker: makeTrello({
      fetch,
      apiUrl: `${API}/`,
      webUrl: 'https://trello.com',
      credential: Effect.succeed({ kind: 'app', key: '0123abcd', token: 'ATTA0000' }),
    }),
    sent,
  }
}

/** GET /cards/dRlAmgAi, on the Trello Development Roadmap. */
const card = (overrides: Record<string, unknown> = {}) => ({
  id: '5c4a1edbee21d48246c126b2',
  name: 'iOS 12 : Siri Command and Security Improvements',
  desc: 'Welcome to Trello on iOS 12  !\nBliss out, we are making your life easier.',
  url: 'https://trello.com/c/dRlAmgAi/1631-ios-12-siri-command-and-security-improvements',
  shortLink: 'dRlAmgAi',
  dateLastActivity: '2020-12-14T22:11:36.708Z',
  closed: false,
  dueComplete: false,
  labels: [{ id: '5c4a1edbee21d48246c126b4', idBoard: '4d5ea62fd76aa1136000000c', name: 'Mobile', color: 'pink', uses: 1 }],
  idBoard: '4d5ea62fd76aa1136000000c',
  idList: '5c4a1ec10405013c8a2fc48e',
  board: { id: '4d5ea62fd76aa1136000000c', name: 'Trello Development Roadmap', closed: false },
  list: { id: '5c4a1ec10405013c8a2fc48e', name: 'Live (Oct-Dec 2018)', closed: false, color: null, idBoard: '4d5ea62fd76aa1136000000c' },
  members: [],
  ...overrides,
})

/** GET /cards/XQYe3hhh: a card someone is on, on a Welcome Board. */
const welcome = {
  id: '4e6a8153efa69909ba0077b5',
  name: "Drag people onto a card to indicate that they're responsible for it.",
  desc: '',
  url: 'https://trello.com/c/XQYe3hhh/8-drag-people-onto-a-card-to-indicate-that-theyre-responsible-for-it',
  shortLink: 'XQYe3hhh',
  dateLastActivity: '2019-04-10T17:16:12.794Z',
  closed: false,
  dueComplete: false,
  labels: [],
  idBoard: '4e6a8095efa69909ba007382',
  idList: '4e6a8095efa69909ba007387',
  members: [{ id: '4e6a7fad05d98b02ba00845c', fullName: 'Trello', username: 'trello' }],
}

/**
 * GET /members/trello with its open cards, and its open boards with their
 * lists, as `mine` asks of `me`. One of the four boards is left out, as an
 * archived board would be; another keeps two of its lists, one archived.
 */
const member = {
  id: '4e6a7fad05d98b02ba00845c',
  cards: [
    welcome,
    {
      ...welcome,
      id: '5b28f28e0a2da53ac38172b6',
      name: 'Voeg alle kaarten en lijsten toe die je nodig hebt.',
      desc: '25 juni koster Gerrit Jan ',
      url: 'https://trello.com/c/W18c44iE/3-voeg-alle-kaarten-en-lijsten-toe-die-je-nodig-hebt',
      shortLink: 'W18c44iE',
      dateLastActivity: '2023-07-01T12:12:10.603Z',
      idBoard: '5b28f28e0a2da53ac38172a5',
      idList: '5b28f28e0a2da53ac38172a6',
    },
    {
      ...welcome,
      id: '55eccabc4ddbac2bea764128',
      url: 'https://trello.com/c/shQLVUu6/8-drag-people-onto-a-card-to-indicate-that-theyre-responsible-for-it',
      shortLink: 'shQLVUu6',
      dateLastActivity: '2015-09-06T23:22:36.761Z',
      idBoard: '55eccabc4ddbac2bea764114',
      idList: '55eccabc4ddbac2bea764117',
    },
    {
      ...welcome,
      id: '52d40dd4dd3c913c7ba17c87',
      url: 'https://trello.com/c/FUKG6oiY/8-drag-people-onto-a-card-to-indicate-that-theyre-responsible-for-it',
      shortLink: 'FUKG6oiY',
      dateLastActivity: '2019-06-16T06:49:15.889Z',
      idBoard: '52d409b1b243f27143c880f5',
      idList: '52d409b1b243f27143c880f7',
    },
  ],
  boards: [
    {
      id: '55eccabc4ddbac2bea764114',
      name: "Rollikin's Commissions",
      lists: [
        { id: '55eccabc4ddbac2bea764117', name: 'Intermediate', closed: true, idBoard: '55eccabc4ddbac2bea764114' },
        { id: '67dc815dc97f33bd5ad9a8cf', name: 'Finished', closed: false, idBoard: '55eccabc4ddbac2bea764114' },
      ],
    },
    {
      id: '52d409b1b243f27143c880f5',
      name: 'Welcome Board',
      lists: [
        { id: '52d409b1b243f27143c880f6', name: 'Basics', closed: false, idBoard: '52d409b1b243f27143c880f5' },
        { id: '52d409b1b243f27143c880f7', name: 'Intermediate', closed: false, idBoard: '52d409b1b243f27143c880f5' },
      ],
    },
    {
      id: '4e6a8095efa69909ba007382',
      name: 'Welcome Board',
      lists: [
        { id: '4e6a8095efa69909ba007386', name: 'Basics', closed: false, idBoard: '4e6a8095efa69909ba007382' },
        { id: '4e6a8095efa69909ba007387', name: 'Intermediate', closed: false, idBoard: '4e6a8095efa69909ba007382' },
      ],
    },
  ],
}

/** What POST /cards answers, as Trello's API reference shows it: the card as it was made. */
const posted = (overrides: Record<string, unknown> = {}) => ({
  id: '5c4a1edbee21d48246c126b2',
  badges: { votes: 0, comments: 0 },
  closed: false,
  dateLastActivity: '2026-10-11T09:00:00.000Z',
  desc: 'Siri, **securely**.',
  idBoard: '4d5ea62fd76aa1136000000c',
  idList: '5c4a1ec10405013c8a2fc48e',
  idLabels: ['label-mobile'],
  labels: [{ id: 'label-mobile', idBoard: '4d5ea62fd76aa1136000000c', name: 'Mobile', color: 'pink' }],
  name: 'iOS 12',
  shortLink: 'dRlAmgAi',
  shortUrl: 'https://trello.com/c/dRlAmgAi',
  url: 'https://trello.com/c/dRlAmgAi/1632-ios-12',
  ...overrides,
})

const found: Issue = {
  id: '5c4a1edbee21d48246c126b2',
  ref: 'dRlAmgAi',
  key: 'dRlAmgAi',
  title: 'iOS 12 : Siri Command and Security Improvements',
  body: '',
  url: 'https://trello.com/c/dRlAmgAi/1631-ios-12-siri-command-and-security-improvements',
  status: { name: 'Live (Oct-Dec 2018)', category: 'todo' },
  priority: null,
  assignees: [],
  labels: [],
  container: 'Trello Development Roadmap',
  updatedAt: '2020-12-14T22:11:36.708Z',
}

describe('Trello', () => {
  it('reads a list’s name as a category', () => {
    const lists: ReadonlyArray<readonly [string, ReturnType<typeof categoryOf>]> = [
      ['Done', 'done'],
      ['✅ Completed', 'done'],
      ['Shipped this week', 'done'],
      ['finished', 'done'],
      ['Review done', 'done'],
      ['Not done', 'todo'],
      ['Undone', 'todo'],
      ['Cancelled', 'cancelled'],
      ['Canceled', 'cancelled'],
      ["Won't do", 'cancelled'],
      ['Won’t do', 'cancelled'],
      ['Dropped', 'cancelled'],
      ['Rejected', 'cancelled'],
      ['Doing', 'started'],
      ['In progress', 'started'],
      ['In-Progress', 'started'],
      ['Code review', 'started'],
      ['In review', 'started'],
      ['QA', 'started'],
      ['Testing', 'started'],
      ['Blocked', 'started'],
      ['Backlog', 'backlog'],
      ['Icebox', 'backlog'],
      ['To Do', 'todo'],
      ['Live (Oct-Dec 2018)', 'todo'],
    ]
    assert.deepStrictEqual(
      lists.map(([name]) => [name, categoryOf(name)]),
      lists.map(([name, category]) => [name, category]),
    )
  })

  it('takes a token Trello won’t take as a sign-in to do again, and a permission it lacks as only that', () => {
    const failed = (reason: ConnectorFailed['reason'], message: string, status?: number) =>
      new ConnectorFailed({ product: 'trello', reason, message, ...(status === undefined ? {} : { status }) })
    assert.deepInclude(classified(failed('rejected', 'invalid token', 400)), {
      reason: 'unauthorized',
      status: 400,
      message: 'invalid token',
    })
    assert.strictEqual(classified(failed('unauthorized', 'invalid key', 401)).reason, 'unauthorized')
    assert.strictEqual(classified(failed('rejected', 'expired token')).reason, 'unauthorized')
    assert.isUndefined(classified(failed('rejected', 'expired token')).status)
    assert.deepInclude(classified(failed('unauthorized', 'unauthorized permission requested', 401)), { reason: 'forbidden', status: 401 })
    const other = failed('rejected', 'invalid value for idList', 400)
    assert.strictEqual(classified(other), other)
  })

  it.effect('says who it signs in as, with the key and token in a header and not the address', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([
        [
          'GET',
          `${API}/members/me?fields=id,username,fullName`,
          { json: { id: '4e6a7fad05d98b02ba00845c', username: 'trello', fullName: 'Trello' } },
        ],
      ])
      assert.deepStrictEqual(yield* tracker.account, { id: '4e6a7fad05d98b02ba00845c', login: 'trello', name: 'Trello' })
      assert.strictEqual(sent[0]?.headers.authorization, AUTHORIZATION)
      assert.notMatch(sent[0]?.url ?? '', /key=|token=/)
      const nameless = trello([['GET', /\/members\/me\?/, { json: { id: 'm1', username: 'you', fullName: null } }]])
      assert.isNull((yield* nameless.tracker.account).name)
    }),
  )

  it.effect('reads a card by its short link: its list is its status, its board its container', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([['GET', /\/cards\/dRlAmgAi\?/, { json: card() }]])
      assert.deepStrictEqual(yield* tracker.issue('dRlAmgAi'), {
        ...found,
        body: 'Welcome to Trello on iOS 12  !\nBliss out, we are making your life easier.',
        labels: ['Mobile'],
      })
      assert.strictEqual(
        sent[0]?.url,
        `${API}/cards/dRlAmgAi?fields=name,desc,url,shortLink,dateLastActivity,closed,dueComplete,labels,idBoard,idList&members=true&member_fields=fullName,username&list=true&board=true&board_fields=name,closed`,
      )
      assert.strictEqual(sent[0]?.headers.authorization, AUTHORIZATION)
    }),
  )

  it.effect('reads who is on a card, and labels with words', () =>
    Effect.gen(function* () {
      const { tracker } = trello([
        [
          'GET',
          /\/cards\/XQYe3hhh\?/,
          {
            json: {
              ...welcome,
              labels: [
                { name: 'Mobile', color: 'pink' },
                { name: '', color: 'green' },
                { name: null, color: 'red' },
              ],
              board: { id: '4e6a8095efa69909ba007382', name: 'Welcome Board', closed: false },
              list: { id: '4e6a8095efa69909ba007387', name: 'Intermediate', closed: false },
            },
          },
        ],
      ])
      const issue = yield* tracker.issue('XQYe3hhh')
      assert.deepStrictEqual(issue.assignees, [{ id: '4e6a7fad05d98b02ba00845c', login: 'trello', name: 'Trello', bot: false }])
      assert.deepStrictEqual(issue.labels, ['Mobile'])
      assert.deepStrictEqual(
        [issue.key, issue.container, issue.status],
        ['XQYe3hhh', 'Welcome Board', { name: 'Intermediate', category: 'todo' }],
      )
    }),
  )

  it.effect('reads a card archived, or on an archived list or board, as done; a ticked due date only where its list says to do', () =>
    Effect.gen(function* () {
      const { tracker } = trello([
        // QG4i6vXe: archived, on an archived list called In Progress.
        [
          'GET',
          /\/cards\/QG4i6vXe\?/,
          { json: card({ shortLink: 'QG4i6vXe', closed: true, list: { id: 'l1', name: 'In Progress', closed: true } }) },
        ],
        ['GET', /\/cards\/list0001\?/, { json: card({ list: { id: 'l1', name: 'Doing', closed: true } }) }],
        ['GET', /\/cards\/board001\?/, { json: card({ board: { id: 'b1', name: 'Old', closed: true } }) }],
        ['GET', /\/cards\/due00001\?/, { json: card({ dueComplete: true, list: { id: 'l1', name: 'Ideas' } }) }],
        // A milestone ticked on a card still under way.
        ['GET', /\/cards\/due00002\?/, { json: card({ dueComplete: true, list: { id: 'l1', name: 'Doing' } }) }],
        [
          'GET',
          /\/cards\/bare0001\?/,
          {
            json: card({
              desc: undefined,
              labels: undefined,
              members: undefined,
              dueComplete: undefined,
              list: { id: 'l1', name: 'Doing' },
            }),
          },
        ],
      ])
      for (const ref of ['QG4i6vXe', 'list0001', 'board001', 'due00001'])
        assert.strictEqual((yield* tracker.issue(ref)).status.category, 'done', ref)
      assert.deepStrictEqual((yield* tracker.issue('QG4i6vXe')).status, { name: 'In Progress', category: 'done' })
      assert.deepStrictEqual((yield* tracker.issue('due00002')).status, { name: 'Doing', category: 'started' })
      const bare = yield* tracker.issue('bare0001')
      assert.deepStrictEqual([bare.body, bare.labels, bare.assignees, bare.status], ['', [], [], { name: 'Doing', category: 'started' }])
    }),
  )

  it.effect('says a card isn’t there, or that what it was given isn’t a card, without asking', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([['GET', /\/cards\/zzzzzzzz\?/, { status: 404, text: 'Card not found' }]])
      assert.deepInclude(yield* Effect.flip(tracker.issue('zzzzzzzz')), { reason: 'not_found', status: 404, message: 'Card not found' })
      assert.deepInclude(yield* Effect.flip(tracker.issue('MER-231')), { reason: 'not_found', message: 'Not a Trello card: MER-231' })
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('says when the key or token is no longer good, however Trello says it', () =>
    Effect.gen(function* () {
      const { tracker } = trello([
        ['GET', /\/members\/me\?fields=id,username/, { status: 400, text: 'invalid token' }],
        ['GET', /\/cards\/dRlAmgAi\?/, { status: 401, text: 'invalid key' }],
        ['GET', /\/cards\/private1\?/, { status: 401, text: 'unauthorized permission requested' }],
      ])
      assert.strictEqual((yield* Effect.flip(tracker.account)).reason, 'unauthorized')
      assert.strictEqual((yield* Effect.flip(tracker.issue('dRlAmgAi'))).reason, 'unauthorized')
      // A card on a board the account isn't on: the sign-in is fine.
      assert.strictEqual((yield* Effect.flip(tracker.issue('private1'))).reason, 'forbidden')
    }),
  )

  it.effect('lists the account’s open cards on open boards and lists, newest first, in one call', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([['GET', /\/members\/me\?fields=id&cards=open/, { json: member }]])
      const mine = yield* tracker.mine()
      assert.deepStrictEqual(
        mine.map((issue) => [issue.key, issue.container, issue.status.name, issue.updatedAt]),
        [
          ['FUKG6oiY', 'Welcome Board', 'Intermediate', '2019-06-16T06:49:15.889Z'],
          ['XQYe3hhh', 'Welcome Board', 'Intermediate', '2019-04-10T17:16:12.794Z'],
        ],
      )
      assert.deepStrictEqual(
        mine[0]?.assignees.map((person) => person.login),
        ['trello'],
      )
      assert.strictEqual(
        sent[0]?.url,
        `${API}/members/me?fields=id&cards=open&card_fields=name,desc,url,shortLink,dateLastActivity,closed,dueComplete,labels,idBoard,idList&card_members=true&card_member_fields=fullName,username&boards=open&board_fields=name&board_lists=all`,
      )
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('leaves done and cancelled cards out, keeps to a board when given one, and stops at the limit', () =>
    Effect.gen(function* () {
      const finished = {
        ...welcome,
        id: 'c5',
        shortLink: 'Fin00001',
        dateLastActivity: '2026-10-01T00:00:00.000Z',
        idBoard: '55eccabc4ddbac2bea764114',
        idList: '67dc815dc97f33bd5ad9a8cf',
      }
      const ticked = { ...welcome, id: 'c6', shortLink: 'Due00001', dateLastActivity: '2026-10-02T00:00:00.000Z', dueComplete: true }
      // A list added to a Welcome Board, for a card no one will do.
      const dropped = { ...welcome, id: 'c7', shortLink: 'Wont0001', dateLastActivity: '2026-10-03T00:00:00.000Z', idList: 'wontdo01' }
      const boards = member.boards.map((board) =>
        board.id === welcome.idBoard ? { ...board, lists: [...board.lists, { id: 'wontdo01', name: "Won't do", closed: false }] } : board,
      )
      const { tracker } = trello([
        ['GET', /\/members\/me\?/, { json: { ...member, cards: [...member.cards, finished, ticked, dropped], boards } }],
      ])
      assert.deepStrictEqual(
        (yield* tracker.mine()).map((issue) => issue.key),
        ['FUKG6oiY', 'XQYe3hhh'],
      )
      assert.deepStrictEqual(
        (yield* tracker.mine({ container: 'Welcome Board', limit: 1 })).map((issue) => issue.key),
        ['FUKG6oiY'],
      )
      assert.deepStrictEqual(yield* tracker.mine({ container: "Rollikin's Commissions" }), [])
    }),
  )

  it.effect('comments on a card, and attaches a link once', () =>
    Effect.gen(function* () {
      // GET /cards/qYtVVU3w/attachments, with the link once it is attached.
      let attachments = [
        {
          id: '60141626bb21bd5714fe8c51',
          url: 'https://trello.com/1/cards/60141618e641095ae5f858dd/attachments/60141626bb21bd5714fe8c51/download/image.png',
        },
      ]
      const { tracker, sent } = trello([
        [
          'POST',
          `${API}/cards/5c4a1edbee21d48246c126b2/actions/comments`,
          { json: { id: 'a1', type: 'commentCard', data: { text: 'Picked up' } } },
        ],
        ['GET', `${API}/cards/5c4a1edbee21d48246c126b2/attachments?fields=url`, () => ({ json: attachments })],
        [
          'POST',
          `${API}/cards/5c4a1edbee21d48246c126b2/attachments`,
          () => {
            attachments = [...attachments, { id: 'att2', url: 'https://github.com/meridian/api/pull/12' }]
            return { json: { id: 'att2', name: 'PR #12', url: 'https://github.com/meridian/api/pull/12' } }
          },
        ],
      ])
      yield* tracker.comment(found, 'Picked up')
      const link = { url: 'https://github.com/meridian/api/pull/12', title: 'PR #12' }
      yield* tracker.link(found, link)
      yield* tracker.link(found, link)
      assert.deepStrictEqual(
        sent.map((request) => [request.method, request.url.replace(`${API}/cards/5c4a1edbee21d48246c126b2`, ''), request.body]),
        [
          ['POST', '/actions/comments', { text: 'Picked up' }],
          ['GET', '/attachments?fields=url', undefined],
          ['POST', '/attachments', { url: 'https://github.com/meridian/api/pull/12', name: 'PR #12' }],
          ['GET', '/attachments?fields=url', undefined],
        ],
      )
      assert.isTrue(sent.every((request) => request.headers.authorization === AUTHORIZATION))
      assert.isTrue(tracker.capabilities.links)
      assert.strictEqual(tracker.product, 'trello')
    }),
  )
  describe('moving a card to In Progress', () => {
    const CARD = `${API}/cards/5c4a1edbee21d48246c126b2`
    const LISTS = `${API}/boards/4d5ea62fd76aa1136000000c/lists?filter=open&fields=name,closed`
    /** GET /boards/…/lists, in their order on the board: review and blocked read as started too, but aren't where work starts. */
    const lists = [
      { id: 'l-backlog', name: 'Backlog', closed: false },
      { id: 'l-todo', name: 'To Do', closed: false },
      { id: 'l-review', name: 'Code review', closed: false },
      { id: 'l-blocked', name: 'Blocked', closed: false },
      { id: 'l-doing', name: '🔨 Doing', closed: false },
      { id: 'l-progress', name: 'In progress', closed: false },
      { id: 'l-done', name: 'Done', closed: false },
    ]

    it.effect('moves it to the top of its board’s first list for work under way, past those for review or what is blocked', () =>
      Effect.gen(function* () {
        const { tracker, sent } = trello([
          ['GET', `${CARD}?fields=idBoard`, { json: { id: found.id, idBoard: '4d5ea62fd76aa1136000000c' } }],
          ['GET', LISTS, { json: lists }],
          ['PUT', CARD, { json: card({ idList: 'l-doing' }) }],
        ])
        assert.deepStrictEqual(yield* tracker.start(found), { moved: true, status: { name: '🔨 Doing', category: 'started' } })
        assert.deepStrictEqual(sent.at(-1)?.body, { idList: 'l-doing', pos: 'top' })
        assert.isTrue(sent.every((request) => request.headers.authorization === AUTHORIZATION))
        assert.isTrue(tracker.capabilities.starts)
      }),
    )

    it.effect('moves one from the backlog too', () =>
      Effect.gen(function* () {
        const { tracker, sent } = trello([
          ['GET', `${CARD}?fields=idBoard`, { json: { id: found.id, idBoard: '4d5ea62fd76aa1136000000c' } }],
          ['GET', LISTS, { json: lists.filter((list) => list.id !== 'l-doing') }],
          ['PUT', CARD, { json: card({ idList: 'l-progress' }) }],
        ])
        const backlog = { ...found, status: { name: 'Backlog', category: 'backlog' as const } }
        assert.deepStrictEqual(yield* tracker.start(backlog), { moved: true, status: { name: 'In progress', category: 'started' } })
        assert.deepStrictEqual(sent.at(-1)?.body, { idList: 'l-progress', pos: 'top' })
      }),
    )

    it.effect('leaves one started, done or cancelled as it is, asking Trello nothing', () =>
      Effect.gen(function* () {
        const { tracker, sent } = trello([])
        for (const status of [
          { name: 'Code review', category: 'started' as const },
          { name: 'Done', category: 'done' as const },
          { name: 'Won’t do', category: 'cancelled' as const },
        ]) {
          assert.deepStrictEqual(yield* tracker.start({ ...found, status }), { moved: false, status })
        }
        assert.lengthOf(sent, 0)
      }),
    )

    it.effect('fails when its board has no list for work under way, or Trello won’t let it be moved', () =>
      Effect.gen(function* () {
        const nowhere = trello([
          ['GET', `${CARD}?fields=idBoard`, { json: { id: found.id, idBoard: '4d5ea62fd76aa1136000000c' } }],
          ['GET', LISTS, { json: lists.filter((list) => list.id !== 'l-doing' && list.id !== 'l-progress') }],
        ])
        const none = yield* Effect.flip(nowhere.tracker.start(found))
        assert.deepStrictEqual([none.reason, none.message], ['rejected', 'Its board has no list named Doing or In progress'])
        assert.isFalse(nowhere.sent.some((request) => request.method === 'PUT'))
        const refused = yield* Effect.flip(
          trello([
            ['GET', `${CARD}?fields=idBoard`, { json: { id: found.id, idBoard: '4d5ea62fd76aa1136000000c' } }],
            ['GET', LISTS, { json: lists }],
            ['PUT', CARD, { status: 401, text: 'unauthorized permission requested' }],
          ]).tracker.start(found),
        )
        assert.deepStrictEqual([refused.reason, refused.message], ['forbidden', 'unauthorized permission requested'])
      }),
    )
  })

  it.effect('lists the open lists on the account’s open boards, each named with its board', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([
        [
          'GET',
          `${API}/members/me/boards?filter=open&fields=name&lists=open`,
          {
            json: [
              {
                id: '4d5ea62fd76aa1136000000c',
                name: 'Trello Development Roadmap',
                lists: [
                  { id: '5c4a1ec10405013c8a2fc48e', name: 'Live (Oct-Dec 2018)', closed: false },
                  { id: '5c4a1ec10405013c8a2fc48f', name: 'Old', closed: true },
                ],
              },
              { id: '4e6a8095efa69909ba007382', name: 'Welcome Board', lists: [{ id: '4e6a8095efa69909ba007387', name: 'Basics' }] },
            ],
          },
        ],
      ])
      assert.deepStrictEqual(yield* tracker.containers(), [
        { id: '5c4a1ec10405013c8a2fc48e', key: null, name: 'Trello Development Roadmap / Live (Oct-Dec 2018)' },
        { id: '4e6a8095efa69909ba007387', key: null, name: 'Welcome Board / Basics' },
      ])
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('files a card on a list, with its board’s labels by those names, in any case, and reads it back', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([
        [
          'GET',
          `${API}/lists/5c4a1ec10405013c8a2fc48e?fields=idBoard,name`,
          { json: { id: '5c4a1ec10405013c8a2fc48e', idBoard: '4d5ea62fd76aa1136000000c', name: 'Live (Oct-Dec 2018)' } },
        ],
        [
          'GET',
          `${API}/boards/4d5ea62fd76aa1136000000c/labels?fields=name&limit=1000`,
          {
            json: [
              { id: 'label-mobile', name: 'Mobile' },
              { id: 'label-mobile-again', name: 'mobile' },
              { id: 'label-green', name: '' },
              { id: 'label-blue', name: null },
              { id: 'label-web', name: 'Web' },
            ],
          },
        ],
        ['POST', `${API}/cards`, { json: posted() }],
        ['GET', /\/cards\/dRlAmgAi\?/, { json: card() }],
      ])
      const filed = yield* tracker.create('5c4a1ec10405013c8a2fc48e', {
        title: 'iOS 12',
        body: 'Siri, **securely**.',
        labels: ['MOBILE', 'Nonesuch', ' '],
      })
      assert.deepStrictEqual([filed.key, filed.labels], ['dRlAmgAi', ['Mobile']])
      assert.deepStrictEqual(sent[2]?.body, {
        idList: '5c4a1ec10405013c8a2fc48e',
        name: 'iOS 12',
        desc: 'Siri, **securely**.',
        idLabels: 'label-mobile',
      })
      assert.lengthOf(sent, 4)
    }),
  )

  it.effect('files a card without asking for labels when it has none, and says what it was given isn’t a list', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([
        [
          'GET',
          `${API}/lists/5c4a1ec10405013c8a2fc48e?fields=idBoard,name`,
          { json: { idBoard: '4d5ea62fd76aa1136000000c', name: 'Live (Oct-Dec 2018)' } },
        ],
        ['GET', `${API}/boards/4d5ea62fd76aa1136000000c/labels?fields=name&limit=1000`, { json: [{ id: 'label-web', name: 'Web' }] }],
        ['POST', `${API}/cards`, { json: posted({ labels: [] }) }],
        ['GET', /\/cards\/dRlAmgAi\?/, { json: card() }],
      ])
      yield* tracker.create('5c4a1ec10405013c8a2fc48e', { title: 'iOS 12', body: '', labels: [] })
      assert.deepStrictEqual(
        sent.map((request) => request.method),
        ['POST', 'GET'],
      )
      assert.deepStrictEqual(sent[0]?.body, { idList: '5c4a1ec10405013c8a2fc48e', name: 'iOS 12', desc: '' })
      // Labels the board has none of: no idLabels.
      yield* tracker.create('5c4a1ec10405013c8a2fc48e', { title: 'iOS 12', body: '', labels: ['Mobile'] })
      assert.deepStrictEqual(sent[4]?.body, { idList: '5c4a1ec10405013c8a2fc48e', name: 'iOS 12', desc: '' })
      const notAList = yield* Effect.flip(tracker.create('../boards', { title: 'iOS 12', body: '', labels: [] }))
      assert.deepStrictEqual([notAList.reason, notAList.message], ['not_found', 'Not a Trello list: ../boards'])
      assert.lengthOf(sent, 6)
    }),
  )

  it.effect('files a card once Trello takes it, though reading it back fails, as Trello answered the filing', () =>
    Effect.gen(function* () {
      for (const failed of [
        { status: 500, json: { message: 'Internal Server Error' } },
        { status: 429, json: { message: 'API_TOKEN_LIMIT_EXCEEDED' } },
      ]) {
        const { tracker, sent } = trello([
          [
            'GET',
            `${API}/lists/5c4a1ec10405013c8a2fc48e?fields=idBoard,name`,
            { json: { idBoard: '4d5ea62fd76aa1136000000c', name: 'Doing' } },
          ],
          [
            'GET',
            `${API}/boards/4d5ea62fd76aa1136000000c/labels?fields=name&limit=1000`,
            { json: [{ id: 'label-mobile', name: 'Mobile' }] },
          ],
          ['POST', `${API}/cards`, { json: posted() }],
          ['GET', /\/cards\/dRlAmgAi\?/, failed],
        ])
        const filed = yield* tracker.create('5c4a1ec10405013c8a2fc48e', {
          title: 'iOS 12',
          body: 'Siri, **securely**.',
          labels: ['Mobile'],
        })
        assert.deepStrictEqual(filed, {
          id: '5c4a1edbee21d48246c126b2',
          ref: 'dRlAmgAi',
          key: 'dRlAmgAi',
          title: 'iOS 12',
          body: 'Siri, **securely**.',
          url: 'https://trello.com/c/dRlAmgAi/1632-ios-12',
          // Its list as read for its labels.
          status: { name: 'Doing', category: 'started' },
          priority: null,
          assignees: [],
          labels: ['Mobile'],
          container: null,
          updatedAt: '2026-10-11T09:00:00.000Z',
        })
        assert.lengthOf(sent, 4)
      }
      // Without labels its list isn't read: it is to do, and its time is now where Trello didn't say.
      const { tracker } = trello([
        ['POST', `${API}/cards`, { json: posted({ labels: undefined, desc: undefined, dateLastActivity: undefined }) }],
        ['GET', /\/cards\/dRlAmgAi\?/, { status: 500 }],
      ])
      const bare = yield* tracker.create('5c4a1ec10405013c8a2fc48e', { title: 'iOS 12', body: 'A body', labels: [] })
      assert.deepStrictEqual([bare.status, bare.body, bare.labels], [{ name: 'To do', category: 'todo' }, 'A body', []])
      assert.isFalse(Number.isNaN(Date.parse(bare.updatedAt)))
    }),
  )

  it.effect('fails to file a card when its board’s labels can’t be read, before anything is filed', () =>
    Effect.gen(function* () {
      const { tracker, sent } = trello([
        [
          'GET',
          `${API}/lists/5c4a1ec10405013c8a2fc48e?fields=idBoard,name`,
          { json: { idBoard: '4d5ea62fd76aa1136000000c', name: 'Doing' } },
        ],
        [
          'GET',
          `${API}/boards/4d5ea62fd76aa1136000000c/labels?fields=name&limit=1000`,
          { status: 429, json: { message: 'API_TOKEN_LIMIT_EXCEEDED' } },
        ],
        ['POST', `${API}/cards`, { json: posted() }],
      ])
      const failed = yield* Effect.flip(tracker.create('5c4a1ec10405013c8a2fc48e', { title: 'iOS 12', body: '', labels: ['Mobile'] }))
      assert.strictEqual(failed.reason, 'rate_limited')
      assert.isFalse(sent.some((request) => request.method === 'POST'))
    }),
  )

  describe('changing a card', () => {
    const BOARD = '4d5ea62fd76aa1136000000c'
    const CARD = found.id
    const boardOf: Route = ['GET', `${API}/cards/${CARD}?fields=idBoard`, { json: { id: CARD, idBoard: BOARD } }]
    const readBack: Route = ['GET', /\/cards\/5c4a1edbee21d48246c126b2\?fields=name/, { json: card() }]

    it('changes its list, archives it, and changes its people, labels and name; a card has no priority or project', () => {
      assert.deepStrictEqual(trello([]).tracker.capabilities.changes, ['status', 'close', 'assignee', 'labels', 'title'])
    })

    it.effect('offers its board’s open lists, its labels with a name, and its people', () =>
      Effect.gen(function* () {
        const { tracker } = trello([
          boardOf,
          [
            'GET',
            `${API}/boards/${BOARD}/lists?filter=open&fields=name,closed`,
            {
              json: [
                { id: 'aaa1', name: 'To do' },
                { id: 'aaa2', name: 'Doing' },
              ],
            },
          ],
          [
            'GET',
            `${API}/boards/${BOARD}/labels?fields=name&limit=1000`,
            { json: [{ id: 'lab1', name: 'Mobile' }, { id: 'lab2', name: '' }, { id: 'lab3' }] },
          ],
          [
            'GET',
            `${API}/boards/${BOARD}/members?fields=fullName,username`,
            { json: [{ id: 'mem1', username: 'taco', fullName: 'Taco' }] },
          ],
        ])
        assert.deepStrictEqual(yield* tracker.choices(found, 'status'), [
          { id: 'aaa1', name: 'To do' },
          { id: 'aaa2', name: 'Doing' },
        ])
        assert.deepStrictEqual(yield* tracker.choices(found, 'labels'), [{ id: 'lab1', name: 'Mobile' }])
        assert.deepStrictEqual(yield* tracker.choices(found, 'assignee'), [{ id: 'mem1', name: 'Taco', also: ['taco'] }])
        assert.strictEqual((yield* Effect.flip(tracker.choices(found, 'project'))).reason, 'rejected')
      }),
    )

    it.effect(
      'moves, renames and archives it and puts one person on it in one edit, then adds and takes off labels, and reads it back',
      () =>
        Effect.gen(function* () {
          const { tracker, sent } = trello([
            ['PUT', `${API}/cards/${CARD}`, { json: {} }],
            ['POST', `${API}/cards/${CARD}/idLabels`, { json: [] }],
            ['DELETE', `${API}/cards/${CARD}/idLabels/lab9`, { json: {} }],
            readBack,
          ])
          yield* tracker.update(
            { ...found, labels: ['Mobile'] },
            {
              title: 'Siri, again',
              status: { id: 'aaa2', name: 'Doing' },
              assignee: { id: 'mem1', name: 'Taco' },
              close: true,
              labels: {
                add: [
                  { id: 'lab1', name: 'mobile' },
                  { id: 'lab2', name: 'Web' },
                ],
                remove: [{ id: 'lab9', name: 'Old' }],
              },
            },
          )
          assert.deepStrictEqual(sent[0]?.body, { name: 'Siri, again', idList: 'aaa2', idMembers: 'mem1', closed: true })
          // A label it has already isn't added again.
          assert.deepStrictEqual(
            sent.slice(1, 3).map((request) => [request.method, request.url, request.body]),
            [
              ['POST', `${API}/cards/${CARD}/idLabels`, { value: 'lab2' }],
              ['DELETE', `${API}/cards/${CARD}/idLabels/lab9`, undefined],
            ],
          )
        }),
    )

    it.effect('takes everyone off for no assignee, and refuses a priority or an id that isn’t Trello’s before asking anything', () =>
      Effect.gen(function* () {
        const { tracker, sent } = trello([['PUT', `${API}/cards/${CARD}`, { json: {} }], readBack])
        yield* tracker.update(found, { assignee: null })
        assert.deepStrictEqual(sent[0]?.body, { idMembers: '' })
        const refusing = trello([])
        assert.strictEqual((yield* Effect.flip(refusing.tracker.update(found, { priority: 'low' }))).reason, 'rejected')
        assert.strictEqual(
          (yield* Effect.flip(refusing.tracker.update(found, { status: { id: '../boards', name: 'x' } }))).reason,
          'not_found',
        )
        assert.lengthOf(refusing.sent, 0)
      }),
    )
  })
})
