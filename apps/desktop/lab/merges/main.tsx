import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Markdown, TaskFace, Thread, ThreadShellProvider, Tool, ToolKind, Turn, WorkedFor, You } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { coordinatorSigned } from '../../src/renderer/shared/signed'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { ago, useNow } from '../../src/renderer/shared/time'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor } from '../../tests/render'
import { askedAt, COORDINATOR, itemsOf, type Moment, type Scenario, sinceItems, storyOf } from './data'
import { FootLine, Landed, MergeCard, MergeTrack } from './units'
import s from './lab.module.css'

/*
 * The merges lab (README.md): the coordinator's thread after the person asks
 * it to merge, today and in three directions, at four moments. The bar along
 * the bottom, or its keys, swaps them in place; ?theme=dark draws it dark,
 * ?sheet=1 draws a direction's four moments side by side, for its shots.
 */

const DIRECTIONS = [
  { key: 'now', hint: '0', label: 'Today' },
  { key: 'a', hint: 'A', label: 'Card in the reply' },
  { key: 'b', hint: 'B', label: 'A track for each' },
  { key: 'c', hint: 'C', label: 'One line at the foot' },
] as const
type Direction = (typeof DIRECTIONS)[number]['key']

const MOMENTS: ReadonlyArray<readonly [Moment, string]> = [
  [1, 'Just asked'],
  [2, 'Some merged'],
  [3, 'One sent back'],
  [4, 'All in'],
]

/** The moments as the one pull request goes through them. */
const ONE_MOMENT: Record<Moment, string> = { 1: 'Just asked', 2: 'In the queue', 3: 'Sent back', 4: 'Merged' }
const momentName = (scenario: Scenario, moment: Moment, label: string) => (scenario === 'one' ? ONE_MOMENT[moment] : label)

const SCENARIOS: ReadonlyArray<readonly [Scenario, string]> = [
  ['four', 'Four at once'],
  ['one', 'Just one'],
]

const params = new URLSearchParams(location.search)
const pick = <T extends string>(value: string | null, from: ReadonlyArray<T>, fallback: T): T =>
  from.includes(value as T) ? (value as T) : fallback

const services = servicesFor(fakeClient().client, fakeHost())
const session = { agentId: COORDINATOR, model: 'opus', account: null }

/** What the coordinator did before it answered, folded under how long it worked: the errands it kept are among them. */
const CALLS = {
  four: [
    'list_tasks',
    'read_pull_request #1224',
    'read_pull_request #1222',
    'read_task Keep for later',
    'read_task Workers readiness',
    'merge_pull_request #1224',
    'merge_pull_request #1222',
    'keep_errand',
  ],
  one: ['read_pull_request #1224', 'merge_pull_request #1224'],
}

/** The thread as each direction draws it, at a moment. */
function Conversation({ direction, scenario, moment }: { direction: Direction; scenario: Scenario; moment: Moment }) {
  const now = useNow(true)
  if (direction === 'now') {
    // Today: the runtime's items, read and drawn by the app's own blocksOf and ThreadBlocks.
    const blocks = blocksOf({ items: itemsOf(scenario, moment), turnRunning: false, worktree: null }, new Map(), (iso) => ago(iso), now)
    return <ThreadBlocks blocks={blocks} threadId={`now-${scenario}-${moment}`} session={session} signed={coordinatorSigned} />
  }
  const story = storyOf(scenario, moment)
  const done = story.going.every((one) => one.state === 'merged')
  const asked = askedAt(moment)
  const answered = new Date(Date.parse(asked) + 58_000).toISOString()
  // What was said since is drawn the app's way, whatever the direction.
  const since = story.since
    ? blocksOf({ items: sinceItems(moment), turnRunning: false, worktree: null }, new Map(), (iso) => ago(iso), now)
    : []
  const unit =
    direction === 'a' ? (
      <MergeCard going={story.going} />
    ) : direction === 'b' ? (
      <MergeTrack going={story.going} />
    ) : done ? (
      <Landed going={story.going} />
    ) : null
  return (
    <>
      <You at={ago(asked)}>{story.asked}</You>
      <Turn voice={coordinatorSigned.voice} mark={coordinatorSigned.mark} at={ago(answered)} copy={story.reply}>
        <WorkedFor took={scenario === 'four' ? '58s' : '15s'}>
          {CALLS[scenario].map((call) => (
            <Tool key={call} kind={ToolKind.Mcp} verb="Called" target={call} />
          ))}
        </WorkedFor>
        <Markdown source={story.reply} />
        {unit}
      </Turn>
      {since.length > 0 && <ThreadBlocks blocks={since} threadId="since" session={session} signed={coordinatorSigned} />}
      {direction === 'c' && !done && <FootLine going={story.going} open={params.get('open') === '1'} />}
    </>
  )
}

function Composer() {
  return <div className={s.composer}>Ask the coordinator</div>
}

/** The coordinator's conversation face, as the project's screen draws it. */
function Face({ children }: { children: ReactNode }) {
  return (
    <TaskFace className={s.face} composer={<Composer />}>
      <Thread label="Conversation">
        <ThreadShellProvider value={{}}>{children}</ThreadShellProvider>
      </Thread>
    </TaskFace>
  )
}

/** A direction's four moments side by side, each captioned: what its shots are taken of. */
function Sheet({ direction, scenario }: { direction: Direction; scenario: Scenario }) {
  const name = DIRECTIONS.find((one) => one.key === direction)
  return (
    <div className={s.sheet}>
      {MOMENTS.map(([moment, label]) => (
        <figure key={moment} className={s.cell}>
          <figcaption className={s.caption}>
            {name?.hint === '0' ? 'Today' : `${name?.hint} · ${name?.label}`} — {momentName(scenario, moment, label)}
          </figcaption>
          <div className={s.cellThread}>
            <Thread label={label}>
              <ThreadShellProvider value={{}}>
                <Conversation direction={direction} scenario={scenario} moment={moment} />
              </ThreadShellProvider>
            </Thread>
          </div>
        </figure>
      ))}
    </div>
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>(
    pick(
      params.get('d'),
      DIRECTIONS.map((one) => one.key),
      'a',
    ),
  )
  const [moment, setMoment] = useState<Moment>(Number(pick(params.get('m'), ['1', '2', '3', '4'], '1')) as Moment)
  const [scenario, setScenario] = useState<Scenario>(pick<Scenario>(params.get('s'), ['four', 'one'], 'four'))
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  const [playing, setPlaying] = useState(false)
  const sheet = params.get('sheet') === '1'

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  // Playing, the moments come one after another, as they would over twenty minutes.
  useEffect(() => {
    if (!playing) return
    // oxlint-disable-next-line althar/one-clock -- a lab page's own timer
    const timer = setInterval(() => setMoment((was) => ((was % 4) + 1) as Moment), 2400)
    return () => clearInterval(timer)
  }, [playing])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const chosen = DIRECTIONS.find((one) => one.hint.toLowerCase() === key)
      if (chosen !== undefined) return setDirection(chosen.key)
      if (['1', '2', '3', '4'].includes(key)) {
        setPlaying(false)
        return setMoment(Number(key) as Moment)
      }
      if (key === 's') return setScenario((was) => (was === 'four' ? 'one' : 'four'))
      if (key === 'p') return setPlaying((was) => !was)
      if (key === 'd') return setDark((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('m', String(moment))
    url.searchParams.set('s', scenario)
    if (dark) url.searchParams.set('theme', 'dark')
    else url.searchParams.delete('theme')
    history.replaceState(null, '', url)
  }, [direction, moment, scenario, dark])

  if (sheet) return <Sheet direction={direction} scenario={scenario} />

  return (
    <div className={s.lab}>
      <main className={s.scene}>
        <div className={s.column}>
          <Face key={`${scenario}`}>
            <Conversation direction={direction} scenario={scenario} moment={moment} />
          </Face>
        </div>
      </main>
      <nav className={s.bar} aria-label="Directions">
        <div className={s.group}>
          {DIRECTIONS.map((one) => (
            <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => setDirection(one.key)}>
              <kbd>{one.hint}</kbd> {one.label}
            </button>
          ))}
        </div>
        <div className={s.group}>
          {MOMENTS.map(([one, label]) => (
            <button
              key={one}
              type="button"
              aria-pressed={moment === one}
              onClick={() => {
                setPlaying(false)
                setMoment(one)
              }}
            >
              <kbd>{one}</kbd> {momentName(scenario, one, label)}
            </button>
          ))}
          <button type="button" aria-pressed={playing} onClick={() => setPlaying((was) => !was)}>
            <kbd>P</kbd> {playing ? 'Stop' : 'Play'}
          </button>
        </div>
        <div className={s.group}>
          {SCENARIOS.map(([one, label]) => (
            <button key={one} type="button" aria-pressed={scenario === one} onClick={() => setScenario(one)}>
              {label}
            </button>
          ))}
          <span className={s.hint}>
            <kbd>S</kbd>
          </span>
        </div>
        <div className={s.group}>
          <button type="button" aria-pressed={dark} onClick={() => setDark((was) => !was)}>
            <kbd>D</kbd> Dark
          </button>
        </div>
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Lab />
      </ServicesProvider>
    </StrictMode>,
  )
