import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Evidence, Picture, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { countsOf, nowOf, type Round, type RoundBlock, roundsOf, shorter, withoutShotList } from '../src/renderer/shared/rounds'
import { fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's thread in rounds (ADR-042): each ask, then its lead's
 * acknowledgement, its work in one line, and its result with what its report
 * showed; what the coordinator passed on, on the person's side; Althar's
 * housekeeping with the work, and its news a line of its own.
 */

function Task({ onSignIn }: { onSignIn?: (agentId: string) => void }) {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} {...(onSignIn === undefined ? {} : { onSignIn })} />
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString()
const when = (item: ThreadItem, minutes: number): ThreadItem => ({ ...item, createdAt: at(minutes) })
const read = (blocks: ReadonlyArray<ThreadItem>, running = false, now = at(60)) =>
  roundsOf({ items: blocks, turnRunning: running, worktree: '/w/meridian' }, new Map(), () => 'just now', now)
const roundOf = (blocks: ReadonlyArray<RoundBlock>, index = 0) => blocks.filter((block): block is Round => block.kind === 'round')[index]

const picture = (digest: string, name: string): Picture => ({
  digest,
  mediaType: 'image/png',
  bytes: 1201,
  width: 1440,
  height: 900,
  name,
  unkept: null,
})
const shot = (digest: string, caption: string): Evidence => ({
  kind: 'screenshot',
  caption,
  picture: { ...picture(digest, `${caption.slice(0, 2)}.png`) },
  command: null,
  exit: null,
  text: null,
  dropped: 0,
})

describe('a task’s thread in rounds', () => {
  it('answers an ask with what the lead said first, its work in one line, and what it said last', () => {
    const blocks = read([
      when(items.you('Add a retry'), 0),
      when(items.says('On it: the retry goes in the payment call.'), 1),
      when(items.tool({ title: 'Read checkout.ts', locations: [{ path: '/w/meridian/src/checkout.ts' }] }), 2),
      when(items.says('Found the call.'), 3),
      when(items.tool({ title: 'Edit checkout.ts', toolKind: 'edit', locations: [{ path: '/w/meridian/src/checkout.ts' }] }), 4),
      when(items.tool({ title: 'npm test', toolKind: 'execute', command: 'npm test' }), 5),
      when(items.says('Done: it retries once.'), 9),
    ])
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'round'])
    const round = roundOf(blocks)
    expect(round?.ack?.text).toBe('On it: the retry goes in the payment call.')
    expect(round?.result?.text).toBe('Done: it retries once.')
    // What it said on the way is with its work.
    expect(round?.work?.steps.map((step) => step.kind)).toEqual(['tool', 'message', 'tool', 'tool'])
    expect(round?.work?.counts).toBe('edited 1 file, read 1 file, ran 1 command')
    expect(round?.work?.took).toBe('7m 0s')
  })

  it('takes no acknowledgement from what the lead said only after changing something, or long after', () => {
    const late = roundOf(read([items.you('Go'), when(items.tool({}), 0), when(items.says('Reading.'), 5), when(items.says('Done.'), 6)]))
    expect(late?.ack).toBeNull()
    const changed = roundOf(
      read([items.you('Go'), when(items.tool({ toolKind: 'edit' }), 0), when(items.says('Edited.'), 1), when(items.says('Done.'), 2)]),
    )
    expect(changed?.ack).toBeNull()
  })

  it('makes its report the result where it came after what it said, and keeps what it said after a report after it', () => {
    const blocks = read([
      items.you('Add a retry'),
      items.tool({}),
      items.says('Handing it in.'),
      items.step({ built: 'Checkout retries once.' }),
      items.says('That’s it: try it with the network off.'),
    ])
    const round = roundOf(blocks)
    expect(round?.report?.result.built).toBe('Checkout retries once.')
    expect(round?.result?.text).toBe('That’s it: try it with the network off.')
    const handed = roundOf(read([items.you('Go'), items.tool({}), items.says('Handing it in.'), items.step({ built: 'Done.' })]))
    expect(handed?.result).toBeNull()
    expect(handed?.work?.steps.some((step) => step.kind === 'message')).toBe(true)
  })

  it('never loses a report: a second with no ask between them closes the first’s round', () => {
    const blocks = read([
      items.you('Prototype it'),
      items.tool({}),
      items.step({ built: 'Seven directions.' }),
      items.says('Committing it.'),
      items.tool({ title: 'git commit', toolKind: 'execute', command: 'git commit' }),
      items.step({ built: 'A switcher.' }),
      items.says('Here it is.'),
    ])
    const rounds = blocks.filter((block): block is Round => block.kind === 'round')
    expect(rounds.map((round) => round.report?.result.built)).toEqual(['Seven directions.', 'A switcher.'])
    expect(rounds[0]?.result).toBeNull()
    expect(rounds[1]?.ack?.text).toBe('Committing it.')
    expect(rounds[1]?.result?.text).toBe('Here it is.')
  })

  it('keeps what the lead handed over on the way with its result, or under its work while there is none', () => {
    const shown = picture('e'.repeat(64), 'found.png')
    const done = roundOf(
      read([
        items.you('Look'),
        items.tool({ toolKind: 'edit' }),
        items.hands('Here is what I found.', { pictures: [shown] }),
        items.tool({}),
        items.says('Reported.'),
      ]),
    )
    expect(done?.result?.handed.pictures.map((one) => one.name)).toEqual(['found.png'])
    expect(done?.handed.pictures).toEqual([])
    const going = roundOf(
      read(
        [items.you('Look'), items.tool({ toolKind: 'edit' }), items.hands('Here is what I found.', { pictures: [shown] }), items.tool({})],
        true,
      ),
    )
    expect(going?.result).toBeNull()
    expect(going?.handed.pictures.map((one) => one.name)).toEqual(['found.png'])
  })

  it('says while it works what it is on, in its own last words, or its last call', () => {
    const live = roundOf(
      read(
        [
          items.you('Go'),
          when(items.says('On it.'), 0),
          when(items.tool({ toolKind: 'edit' }), 1),
          when(items.says('Now the tests, then the docs:'), 2),
          when(items.tool({}), 3),
        ],
        true,
      ),
    )
    expect(live?.live).toBe(true)
    expect(live?.ack?.text).toBe('On it.')
    expect(live?.result).toBeNull()
    expect(live?.work?.now).toBe('Now the tests, then the docs')
    const quiet = roundOf(read([items.you('Go'), when(items.tool({ title: 'Read checkout.ts' }), 0)], true))
    expect(quiet?.work?.now).toBe('Read checkout.ts')
    // Said, and at work with nothing done yet: a line all the same.
    const started = roundOf(read([items.you('Go'), when(items.says('On it.'), 0)], true))
    expect(started?.work).not.toBeNull()
    expect(started?.work?.steps).toEqual([])
  })

  it('times a turn that has said nothing yet after a restart from nothing before it, not from the round Althar stopped', () => {
    // Stopped mid-round, started again the next day: the lead's turn runs, and hasn't said anything yet.
    const day = 24 * 60
    const blocks = read(
      [
        items.you('Go'),
        when(items.tool({ toolKind: 'edit' }), 0),
        when(items.says('Now the tests.'), 5),
        when(items.notice({ source: 'runtime', title: 'Carried on after Althar restarted.' }, null), day),
      ],
      true,
      at(day + 1),
    )
    const stopped = roundOf(blocks)
    expect(stopped?.live).toBe(false)
    expect(stopped?.work?.took).toBe('5m 0s')
    expect(blocks.some((block) => block.kind === 'round' && block.live)).toBe(false)
    // Housekeeping of Althar's is part of the round, which goes on.
    const aside = read(
      [
        items.you('Go'),
        when(items.tool({}), 0),
        when(items.notice({ source: 'runtime', role: 'aside', title: 'Its turn ended before it could do anything.' }, null), 1),
      ],
      true,
      at(3),
    )
    expect(roundOf(aside)?.live).toBe(true)
    // What the person said and the lead read starts the turn that runs now.
    const answered = read([items.you('Go'), when(items.tool({}), 0), when(items.you('And the docs.'), 30)], true, at(31))
    expect(roundOf(answered)?.live).toBe(false)
  })

  it('holds the lead’s reply while it has said nothing since it was asked, and leaves the round before it over', () => {
    const asked = (thread: ReadonlyArray<ThreadItem>, extra: { openedAt?: string } = {}) =>
      roundsOf(
        { items: thread, turnRunning: true, turnStarted: at(50), worktree: '/w/meridian', ...extra },
        new Map(),
        () => 'just now',
        new Date(Date.parse(at(50)) + 12_000).toISOString(),
      )
    const answered = [when(items.you('Go'), 0), when(items.tool(), 1), when(items.says('Done.'), 2)]
    const again = asked([...answered, when(items.you('And the docs?'), 50)])
    expect(again.map((block) => block.kind)).toEqual(['you', 'round', 'you', 'waiting'])
    expect(roundOf(again)).toMatchObject({ live: false, result: { text: 'Done.' }, work: { live: false, took: '1m 0s' } })
    expect(again.at(-1)).toMatchObject({ took: '12s', slow: false })
    // What the coordinator passed on is waited on as well, after a report too.
    const passed = items.notice({ source: 'runtime', title: 'From the coordinator:', description: 'Ship it.', role: 'relayed' }, null)
    expect(asked([...answered, items.step(), when(passed, 50)]).map((block) => block.kind)).toEqual(['you', 'round', 'relayed', 'waiting'])
    // Writing on after its report, the lead's round is at work, with nothing waited for.
    const reported = asked([...answered, items.step()])
    expect(reported.some((block) => block.kind === 'waiting')).toBe(false)
    expect(roundOf(reported)).toMatchObject({ live: true })
    // The task's request, above its items, is what its first turn answers; once a report is in, it has been answered.
    expect(
      asked([when(items.notice({ source: 'runtime', title: 'On a branch of its own' }, null), 0)], { openedAt: at(50) }).at(-1),
    ).toMatchObject({
      kind: 'waiting',
    })
    expect(asked([items.step()], { openedAt: at(50) }).map((block) => block.kind)).toEqual(['round'])
  })

  it('places what the coordinator passed on as an ask, by its role or, before roles, its title', () => {
    const blocks = read([
      items.notice(
        {
          source: 'runtime',
          title: 'From the coordinator:',
          description: 'One more round, from the person: they want it live.',
          role: 'relayed',
        },
        null,
      ),
      items.says('Got it.'),
      items.notice({ source: 'runtime', title: 'From the coordinator:', description: 'Leave the server running.' }, null),
    ])
    expect(blocks[0]).toMatchObject({ kind: 'relayed', title: 'One more round', body: 'they want it live.' })
    expect(blocks[2]).toMatchObject({ kind: 'relayed', title: null, body: 'Leave the server running.' })
  })

  it('keeps Althar’s housekeeping with the work, and says its news in a line, files counted', () => {
    const blocks = read([
      items.you('Go'),
      items.tool({}),
      items.notice({ source: 'runtime', title: 'Branch made.', role: 'aside' }, null),
      items.notice({ source: 'runtime', title: 'This task’s work is on a branch of its own now, althar/x.' }, null),
      items.tool({}),
      items.notice(
        {
          source: 'runtime',
          title: 'PR #157 conflicts with main, in a/b.ts, c/d.ts, e.tsx.',
          description: 'Althar asked the lead to resolve it.',
        },
        null,
      ),
      items.notice({ source: 'runtime', severity: 'warning', title: 'The lead couldn’t resolve the conflict with main.' }, null),
    ])
    const round = roundOf(blocks)
    expect(round?.work?.steps.filter((step) => step.kind === 'aside')).toHaveLength(2)
    const news = blocks.filter((block) => block.kind === 'althar')
    expect(news.map((block) => block.kind === 'althar' && block.text)).toEqual([
      'PR #157 conflicts with main, in 3 files. Althar asked the lead to resolve it.',
      'The lead couldn’t resolve the conflict with main.',
    ])
    expect(news.map((block) => block.kind === 'althar' && block.tone)).toEqual(['info', 'warning'])
    // Housekeeping before any round goes in the next one's work.
    const first = roundOf(read([items.notice({ source: 'runtime', title: 'Branch.', role: 'aside' }, null), items.tool({})]))
    expect(first?.work?.steps[0]?.kind).toBe('aside')
  })

  it('says in the open the error a turn ended with, and keeps the agent’s other notices with its work', () => {
    const round = roundOf(
      read([
        items.you('Go'),
        items.tool({}),
        items.notice({ title: 'Context is filling up', severity: 'warning' }),
        items.notice({ title: 'Claude Code couldn’t answer.', severity: 'error' }),
      ]),
    )
    expect(round?.failed?.text).toBe('Claude Code couldn’t answer.')
    expect(round?.work?.steps.at(-1)).toMatchObject({ kind: 'aside', text: 'Context is filling up' })
  })

  it('gives a review its own voice, a pull request a line, and a report with no round its own', () => {
    const blocks = read([
      items.step({ step: 'review', verdict: 'changes_requested', agentId: 'codex' }),
      items.step({ step: 'settle', summary: 'Settled.', agentId: 'claude-code' }),
      items.step({ step: 'publish', summary: '' }),
    ])
    expect(blocks.map((block) => block.kind)).toEqual(['verdict', 'round', 'published'])
    expect(roundOf(blocks)).toMatchObject({ agentId: 'claude-code', report: { result: { summary: 'Settled.' } } })
  })

  it('counts work in the words a person uses, and says what it is on shortly', () => {
    expect(countsOf([])).toBe('')
    const long = nowOf(`**Now** the ${'long '.repeat(40)}part:`)
    expect(long.length).toBeLessThanOrEqual(110)
    expect(long.endsWith('…')).toBe(true)
    expect(nowOf('Now `this`:')).toBe('Now this')
    expect(shorter('Conflicts, in one/file.ts. Asked.')).toBe('Conflicts, in one/file.ts. Asked.')
  })

  it('keeps pictures the lead showed open in its round, where it showed them, never in its work', () => {
    const light = { caption: 'Settings, light', picture: picture('a'.repeat(64), 'light.png') }
    const dark = { caption: 'Settings, dark', picture: picture('b'.repeat(64), 'dark.png') }
    // With no step open, after its plan: shown, then said.
    const before = roundOf(
      read([
        when(items.you('Can I see more screenshots?'), 0),
        when(items.tool({ title: 'npx playwright test', toolKind: 'execute' }), 1),
        when(items.tool({ title: 'show_pictures', toolKind: 'other' }), 2),
        when(items.shows([light, dark]), 2),
        when(items.says('Those are the six states.'), 3),
      ]),
    )
    expect(before?.shown.before.map((shown) => shown.pictures.map((one) => one.caption))).toEqual([['Settings, light', 'Settings, dark']])
    expect(before?.shown.after).toEqual([])
    expect(before?.work?.steps.map((step) => step.kind)).toEqual(['tool', 'tool'])
    // Said, then shown: after what it said.
    const after = roundOf(read([when(items.you('Show me'), 0), when(items.says('Here they are:'), 1), when(items.shows([light]), 2)]))
    expect(after?.result?.text).toBe('Here they are:')
    expect(after?.shown.before).toEqual([])
    expect(after?.shown.after.map((shown) => shown.pictures.length)).toEqual([1])
  })

  it('drops a table of the shots shown under a message, with the line that brings it in, and keeps any other table', () => {
    const listed = [
      'Here it is.',
      '',
      '**Screenshots** (in `.althar/shots/`)',
      '',
      '| # | Caption |',
      '|---|---|',
      '| A1 | The first |',
      '| A2 | The second |',
      '',
      'Try it.',
    ].join('\n')
    expect(withoutShotList(listed, new Set(['A1', 'A2']))).toBe(['Here it is.', '', 'Try it.'].join('\n'))
    const real = '| Setting | Where |\n|---|---|\n| Keep awake | Work on this Mac |'
    expect(withoutShotList(real, new Set(['A1']))).toBe(real)
    expect(withoutShotList(listed, new Set())).toBe(listed)
    expect(withoutShotList('Shots below:\n| A1 | x |\n|---|---|\n| A1 | y |', new Set(['A1']))).toBe('')
  })
})

describe('a task’s lead that is signed out', () => {
  const signedOut = items.notice({
    severity: 'error',
    title: 'Claude Code is signed out.',
    description: 'Authentication required',
    failure: 'auth_required',
  })
  const show = (overrides: Partial<ThreadSnapshot> = {}) => {
    const onSignIn = vi.fn()
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: [items.you('Go'), signedOut], ...overrides })) })
    withServices(<Task onSignIn={onSignIn} />, client)
    return { client, onSignIn }
  }

  it('says so plainly, with the agent’s words under it, and offers Sign in again first, for that agent', async () => {
    const { onSignIn } = show()
    expect(await screen.findByText('Claude Code is signed out.')).toBeTruthy()
    expect(screen.getByText('Authentication required')).toBeTruthy()
    const [first, second] = within(screen.getByText('Sign in again').closest('p') as HTMLElement).getAllByRole('button')
    expect(first?.textContent).toBe('Sign in again')
    expect(second?.textContent).toBe('Try again')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(onSignIn).toHaveBeenCalledWith('claude-code')
  })

  it('tries the turn again, once signed in, from Try again', async () => {
    const { client } = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(client.tryAgain).toHaveBeenCalledWith('th1')
  })

  it('leaves the ways on to its step’s call, where the step waits on the person', async () => {
    show({
      attention: [
        {
          id: 'att1',
          kind: 'stuck',
          title: 'Implement',
          reason: '',
          command: null,
          stuck: { step: 'implement', why: 'signed_out', detail: null, agentId: 'claude-code', round: 0, open: 0 },
          createdAt: at(1),
        } as never,
      ],
    })
    expect((await screen.findAllByText(/^Claude Code is signed out\.$/)).length).toBeGreaterThan(0)
    // One Sign in again, the card's own, first; Try again is the card's too.
    expect(screen.getAllByRole('button', { name: 'Sign in again' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1)
  })
})

describe('a task’s thread in rounds, on its screen', () => {
  const show = (blocks: ReadonlyArray<ThreadItem>, overrides: Partial<ThreadSnapshot> = {}) => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot({ items: blocks, ...overrides })) })
    withServices(<Task />, client)
    return client
  }

  it('shows what the coordinator passed on on the person’s side, in a line and the rest on a click', async () => {
    show([
      items.notice(
        {
          source: 'runtime',
          title: 'From the coordinator:',
          description: 'One more round, from the person: they want it live, with a bar.',
          role: 'relayed',
        },
        null,
      ),
      items.says('Got it: one live page.'),
    ])
    expect(await screen.findByText('From the coordinator')).toBeTruthy()
    expect(screen.getByText('One more round')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy()
  })

  it('shows each report’s screenshots large, not again when a later report takes the same view, and drops the table listing them', async () => {
    show([
      items.you('Prototype it'),
      items.tool({}),
      items.step({
        built: 'Two directions.',
        evidence: [shot('a'.repeat(64), 'A1 · Quiet: the first'), shot('b'.repeat(64), 'B1 · Loud: the second')],
      }),
      items.notice({ source: 'runtime', title: 'From the coordinator:', description: 'Now with a switcher.', role: 'relayed' }, null),
      items.tool({}),
      items.step({
        built: 'A switcher.',
        evidence: [shot('c'.repeat(64), 'S1 · The switcher'), shot('d'.repeat(64), 'A1 · Quiet, from the switcher')],
      }),
      items.says('Here it is.\n\n**Screenshots**\n\n| # | Caption |\n|---|---|\n| S1 | The switcher |\n| A1 | Quiet |'),
    ])
    expect(await screen.findByRole('heading', { name: 'A · Quiet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View S1 · The switcher full size' })).toBeTruthy()
    // The same view taken again is counted in a line, and opens on a click.
    expect(screen.getByRole('button', { name: 'Also retook 1 shown earlier' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Caption' })).toBeNull()
  })

  it('shows pictures the lead showed with no step open, captioned, in order, each opening in the lightbox with the set a key away', async () => {
    const user = userEvent.setup()
    show([
      items.you('Can I see more screenshots?'),
      items.tool({ title: 'show_pictures', toolKind: 'other' }),
      items.shows([
        { caption: 'Settings, light', picture: picture('a'.repeat(64), 'light.png') },
        { caption: 'Settings, dark', picture: picture('b'.repeat(64), 'dark.png') },
      ]),
      items.says('Those are both themes.'),
    ])
    const light = await screen.findByRole('button', { name: 'View Settings, light full size' })
    const captions = screen.getAllByRole('figure').map((figure) => within(figure).getByText(/^Settings/).textContent)
    expect(captions).toEqual(['Settings, light', 'Settings, dark'])
    await user.click(light)
    const dialog = await screen.findByRole('dialog', { name: 'light.png' })
    expect(within(dialog).getByRole('img', { name: 'Settings, light' }).getAttribute('src')).toBe(`althar-picture://shot/${'a'.repeat(64)}`)
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('dialog', { name: 'dark.png' })).toBeTruthy()
  })

  it('says Althar’s news by name, a pull request it opened, and an error a round ended with', async () => {
    show([
      items.you('Go'),
      items.tool({}),
      items.notice({ title: 'Claude Code couldn’t answer.', severity: 'error' }),
      items.notice({ source: 'runtime', severity: 'warning', title: 'The lead couldn’t resolve the conflict with main.' }, null),
      items.step({
        step: 'publish',
        summary: '',
        change: {
          product: 'github',
          number: 142,
          title: 'Add a retry',
          url: 'https://github.com/acme/meridian/pull/142',
          state: 'open',
          draft: false,
          short: 'PR',
          prefix: '#',
          repository: 'acme/meridian',
        } as never,
      }),
    ])
    expect(await screen.findByText('Claude Code couldn’t answer.')).toBeTruthy()
    expect(screen.getByText('The lead couldn’t resolve the conflict with main.')).toBeTruthy()
    expect(screen.getAllByText('Althar').length).toBeGreaterThan(1)
    // A pull request opened, said by Althar where its report says nothing, with the pull request under it.
    expect(screen.getByText('Opened PR #142.')).toBeTruthy()
    expect(screen.getByText('acme/meridian · Open')).toBeTruthy()
  })

  it('says a branch it only pushed, and a pull request merged', async () => {
    show([
      items.step({ step: 'publish', summary: '', change: null }),
      items.step({
        step: 'publish',
        summary: '',
        change: {
          product: 'github',
          number: 7,
          title: 'Merged one',
          url: 'https://x/7',
          state: 'merged',
          draft: false,
          short: 'PR',
          prefix: '#',
          repository: 'acme/m',
        } as never,
      }),
    ])
    expect(await screen.findByText('Pushed the branch.')).toBeTruthy()
    expect(screen.getByText('acme/m · Merged')).toBeTruthy()
  })

  it('says nothing of a setup that went through, and shows one that failed', async () => {
    show([
      items.setup({ ended: { at: at(1), code: 0, timedOut: false, stopped: false, last: null } }),
      items.setup({ repository: 'web', ended: { at: at(2), code: 1, timedOut: false, stopped: false, last: 'npm ERR! missing' } }),
    ])
    expect(await screen.findByText(/Couldn’t install dependencies in web/)).toBeTruthy()
    expect(screen.queryByText(/Installed dependencies/)).toBeNull()
  })

  it('shows a round at work with what it is on, and one that said nothing as a line with who worked', async () => {
    const base = snapshot({
      items: [
        items.you('Go'),
        items.tool({ title: 'npm test', toolKind: 'execute', command: 'npm test' }),
        items.you('And?'),
        items.says('Looking.'),
      ],
    })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } })),
    })
    withServices(<Task />, client)
    const quiet = await screen.findByRole('button', { name: /worked 0s/ })
    expect(within(quiet).getByText('Claude Opus')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/^Working · /)).toBeTruthy())
  })

  it('shows the lead thinking under its name before its first word, with the round before it as it was', async () => {
    const asked = { ...items.you('And the docs?'), createdAt: new Date().toISOString() }
    const base = snapshot({ items: [items.you('Go'), items.says('Done.'), asked] })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        session: base.session === null ? null : { ...base.session, turnRunning: true, turnStartedAt: asked.createdAt },
      })),
    })
    withServices(<Task />, client)
    const thinking = await screen.findByText('Thinking')
    expect(thinking.closest('article')?.getAttribute('aria-label')).toBe('Claude Opus')
    expect(screen.getByText('Done.')).toBeTruthy()
    expect(screen.queryByText(/^Working · /)).toBeNull()
  })
})
