import { useId } from 'react'
import { Brand, BrandMark, Icon, LinkButton, Menu, MenuGroup, MenuItem, MenuSeparator } from '@althar/ui'

import type { Held, Places } from '../data'
import { HeldRows, Pips } from '../parts'
import { tasksOf, words } from '../words'
import { chipTrigger, PopoverChip, sliderOf, take } from './chip'
import type { Ctx } from './types'
import s from './popovers.module.css'

/*
 * What the chip opens, four ways. P1 lists each home with its places, this
 * one open with the work in them. P2 puts the number itself at the top, the
 * slider you change it with, then the work. P3 draws a row for each place,
 * numbered: who holds it, which are free, which are closed for now. P4 keeps
 * the real homes menu and gives each home a line of places, then the work as
 * items. Every one ends with the other homes, Connect a home… and Manage
 * homes…, as the chip's menu does today.
 */

/** Another home's places, as its window last read them. */
const studio: Places = {
  configured: 8,
  atOnce: 8,
  why: null,
  machine: { count: 8, memory: 64, cores: 24 },
  own: false,
  waiting: 0,
  held: [
    {
      id: 'x',
      taskId: 'x',
      title: 'Nightly dependency check',
      project: 'Ferrous',
      role: 'lead',
      agent: 'Claude Code',
      mark: Brand.ClaudeCode,
      doing: { kind: 'turn' },
      cpu: 0,
      memory: '0',
    },
  ],
}

const opener = (ctx: Ctx) => (taskId: string) => {
  ctx.mac.set(null)
  ctx.onOpen(taskId)
}

/** The number and the way to change it, in a line. */
function NumberLine({ ctx }: { ctx: Ctx }) {
  return (
    <p className={s.number}>
      <span>{words.title}</span>
      <span className={s.numberValue}>{ctx.places.configured}</span>
      <LinkButton
        onClick={() => {
          ctx.mac.set(null)
          ctx.quick.set(true)
        }}
      >
        {words.change}
      </LinkButton>
    </p>
  )
}

/** While the number is lowered: to what, and until when. */
function Lowered({ places }: { places: Places }) {
  const line = words.lowered(places)
  return line === null ? null : <p className={s.lowered}>{line}</p>
}

/** The other homes, a line each, and the homes' own actions. */
function HomesFoot() {
  return (
    <div className={s.foot}>
      <button type="button" className={s.footRow}>
        <Icon name="home" size={14} />
        <span className={s.footName}>studio-vps</span>
        <Pips places={studio} />
        <span className={s.footHint}>Open</span>
      </button>
      <button type="button" className={s.footRow}>
        <Icon name="plus" size={14} />
        <span className={s.footName}>Connect a home…</span>
      </button>
      <button type="button" className={s.footRow}>
        <Icon name="gear" size={14} />
        <span className={s.footName}>Manage homes…</span>
      </button>
    </div>
  )
}

/* ---- P1 · Homes: each home with its places, this one open ---- */

function Homes({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  const id = useId()
  return (
    <div className={s.peek}>
      <section className={s.home} aria-labelledby={`${id}-mac`}>
        <div className={s.homeHead}>
          <Icon name="computer" size={14} className={s.homeIcon} />
          <h2 id={`${id}-mac`} className={s.homeName}>
            {words.machine}
          </h2>
          <span className={s.hint}>This window</span>
        </div>
        <div className={s.indent}>
          <div className={s.meter}>
            <Pips places={places} size="large" />
            <span className={s.count}>{words.atWork(places.held.length, places.configured)}</span>
          </div>
          <Lowered places={places} />
          <HeldRows places={places} onOpen={opener(ctx)} />
          <NumberLine ctx={ctx} />
        </div>
      </section>
      <section className={s.home}>
        <button type="button" className={s.other}>
          <span className={s.homeHead}>
            <Icon name="home" size={14} className={s.homeIcon} />
            <span className={s.homeName}>studio-vps</span>
            <span className={s.hint}>Open</span>
          </span>
          <span className={`${s.meter} ${s.indent}`}>
            <Pips places={studio} />
            <span className={s.countQuiet}>{words.atWork(studio.held.length, studio.configured)}</span>
          </span>
        </button>
      </section>
      <div className={s.menu}>
        <button type="button" className={s.footRow}>
          <Icon name="plus" size={14} />
          <span className={s.footName}>Connect a home…</span>
        </button>
        <button type="button" className={s.footRow}>
          <Icon name="gear" size={14} />
          <span className={s.footName}>Manage homes…</span>
        </button>
      </div>
    </div>
  )
}

/* ---- P2 · The number: the slider at the top, then the work ---- */

function TheNumber({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  return (
    <div className={s.peek}>
      <div className={s.head}>
        <Icon name="computer" size={14} className={s.homeIcon} />
        <h2 className={s.homeName}>{words.machine}</h2>
        <span className={s.hint}>{words.atWork(places.held.length, places.configured)}</span>
      </div>
      <div className={s.slider}>{sliderOf(ctx, true)}</div>
      <section className={s.part}>
        <h3 className={s.eyebrow}>{words.inUse}</h3>
        <HeldRows places={places} onOpen={opener(ctx)} />
      </section>
      <HomesFoot />
    </div>
  )
}

/* ---- P3 · A row a place: numbered, who holds it, free, or closed for now ---- */

type PlaceRow =
  | { readonly kind: 'held'; readonly n: number; readonly held: Held; readonly closes: boolean }
  | { readonly kind: 'free' | 'shut'; readonly from: number; readonly to: number }

/** A row for each place in use, in the order taken; the free and the closed, a row each run. */
const rowsOf = (places: Places): PlaceRow[] => {
  const rows: PlaceRow[] = []
  const total = Math.max(places.configured, places.held.length)
  for (let i = 0; i < total; i++) {
    const held = places.held[i]
    if (held !== undefined) {
      rows.push({ kind: 'held', n: i + 1, held, closes: i >= places.atOnce })
      continue
    }
    const kind = i >= places.atOnce ? 'shut' : 'free'
    const last = rows.at(-1)
    if (last !== undefined && last.kind === kind) rows[rows.length - 1] = { ...last, to: i + 1 }
    else rows.push({ kind, from: i + 1, to: i + 1 })
  }
  return rows
}

function PlaceList({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  const open = opener(ctx)
  return (
    <div className={s.peek}>
      <div className={s.head}>
        <Icon name="computer" size={14} className={s.homeIcon} />
        <h2 className={s.homeName}>{words.machine}</h2>
        <span className={s.hint}>{words.atWork(places.held.length, places.configured)}</span>
      </div>
      <ol className={s.places}>
        {rowsOf(places).map((row) =>
          row.kind === 'held' ? (
            <li key={row.held.id}>
              <button type="button" className={s.place} onClick={() => open(row.held.taskId)} title={row.held.title}>
                <span className={s.placeN}>{row.n}</span>
                <i className={s.placeCell} data-cell="on" />
                <span className={s.placeWords}>
                  <span className={s.placeTitle}>
                    <BrandMark brand={row.held.mark} size={11} className={s.mark} />
                    <span className={s.placeTitleText}>{row.held.title}</span>
                  </span>
                  <span className={s.placeMeta}>
                    {row.held.project} · {words.roles([row.held])}
                    {row.held.doing.kind === 'background' && (
                      <>
                        {' · '}
                        <code className={s.command}>{row.held.doing.command}</code>
                      </>
                    )}
                    {row.held.doing.kind === 'starting' && ` · ${words.starting}`}
                  </span>
                </span>
                {row.closes && <span className={s.placeAside}>{words.closesAfter}</span>}
              </button>
            </li>
          ) : (
            <li key={`${row.kind}-${row.from}`} className={s.placeQuiet}>
              <span className={s.placeN}>{row.from === row.to ? row.from : `${row.from}–${row.to}`}</span>
              <i className={s.placeCell} data-cell={row.kind} />
              <span className={s.placeWords}>{row.kind === 'free' ? words.freePlace : words.closedPlace(places)}</span>
            </li>
          ),
        )}
      </ol>
      <div className={s.part}>
        <NumberLine ctx={ctx} />
      </div>
      <HomesFoot />
    </div>
  )
}

/* ---- P4 · The menu: the chip's menu as it is, each home with a line of places, the work as items ---- */

function HomesMenu({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  const close = () => ctx.mac.set(null)
  const lowered = words.lowered(places)
  return (
    <Menu
      label="Homes"
      trigger={chipTrigger(ctx)}
      align="end"
      width={320}
      descriptions="under"
      open={ctx.mac.open === 'bar'}
      onOpenChange={(open) => ctx.mac.set(open ? 'bar' : null)}
    >
      <MenuGroup label="Homes">
        <MenuItem
          lead={<Icon name="computer" />}
          hint="This window"
          description={
            <span className={s.menuLine}>
              <Pips places={places} />
              <span>
                {words.atWork(places.held.length, places.configured)}
                {lowered === null ? '' : ` · ${lowered}`}
              </span>
            </span>
          }
          onSelect={close}
        >
          {words.machine}
        </MenuItem>
        <MenuItem
          lead={<Icon name="home" />}
          hint="Open"
          description={
            <span className={s.menuLine}>
              <Pips places={studio} />
              <span>{words.atWork(studio.held.length, studio.configured)}</span>
            </span>
          }
          onSelect={close}
        >
          studio-vps
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label={`At work on ${words.machine}`}>
        {tasksOf(places.held).map((agents) => {
          const first = agents[0]!
          return (
            <MenuItem
              key={first.taskId}
              lead={<BrandMark brand={first.mark} size={13} />}
              description={`${first.project} · ${words.roles(agents)}`}
              {...(agents.length > 1 ? { hint: words.places(agents.length) } : {})}
              onSelect={() => ctx.onOpen(first.taskId)}
            >
              {first.title}
            </MenuItem>
          )
        })}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon="agents" hint={String(places.configured)} onSelect={() => ctx.quick.set(true)}>
        {words.title}…
      </MenuItem>
      <MenuItem icon="plus" onSelect={close}>
        Connect a home…
      </MenuItem>
      <MenuItem icon="gear" onSelect={close}>
        Manage homes…
      </MenuItem>
    </Menu>
  )
}

export const P1 = take('p1', '1', 'P1 Homes', 'Each home with its places; This Mac open, with the work in them and the number', (ctx) => (
  <PopoverChip ctx={ctx}>
    <Homes ctx={ctx} />
  </PopoverChip>
))

export const P2 = take(
  'p2',
  '2',
  'P2 The number',
  'The slider at the top, to change the number right there; then the work in the places',
  (ctx) => (
    <PopoverChip ctx={ctx} width={340}>
      <TheNumber ctx={ctx} />
    </PopoverChip>
  ),
)

export const P3 = take(
  'p3',
  '3',
  'P3 A row a place',
  'Each place a numbered row: who holds it, which are free, which are closed for now',
  (ctx) => (
    <PopoverChip ctx={ctx} width={340}>
      <PlaceList ctx={ctx} />
    </PopoverChip>
  ),
)

export const P4 = take(
  'p4',
  '4',
  'P4 The menu',
  'The homes menu as it is: each home with a line of places, then the work as items',
  (ctx) => <HomesMenu ctx={ctx} />,
)
