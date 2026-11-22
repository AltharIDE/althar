import type { ReactNode } from 'react'
import { ControlGrid, ControlModule, ControlToggle, Icon, SettingsNav, type SettingsSection } from '@althar/ui'

import { AddTile, TileGrid, TileLine } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import tt from '../../../../../packages/ui/src/setup/ToolTiles/ToolTiles.module.css'
import { percent } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import { sectionText } from '../../../src/renderer/features/settings/sections'
import type { Worker } from '../data'
import { Readings, SplitBar } from '../parts'
import type { Ctx, Page, Place, Take } from '../types'
import { words } from '../words'
import { ComputerBody, ComputerSheet, computersOf, iconOf, MacSection, setTakingOf, stateOf, takingOf } from './pieces'
import x from './settings.module.css'

/*
 * Three takes on Settings for the home and the computers it runs work on,
 * each made of what Settings already draws, and each the same from studio, a
 * home the window is connected to (H). A computer opens out in place, the
 * same sheet in all three. Work on this Mac holds this Mac's own.
 *
 * A · Tiles: Computers as MCP servers are, a tile each, three across; its
 *     round switch takes new tasks or not, its name opens it.
 * B · Modules: Computers as the quick settings are, each as large as it
 *     matters: the home wide, with its trace, the others under it.
 * C · Home first: Settings under the home's name, a page of its own at the
 *     top of the side; on studio, This Mac's own apart under its name.
 */

type Id = string
const section = (id: keyof typeof sectionText): SettingsSection<Id> => ({ id, ...sectionText[id] })
const COMPUTERS: SettingsSection<Id> = { id: 'computers', title: words.computers, icon: 'computer' }

/** The home's sections: what it keeps, wherever the window is. */
const HOME_SECTIONS: readonly Id[] = ['agents', 'mcp-servers', 'skills', 'code-hosts', 'tasks', 'pull-requests']

/** Where a press on the side goes: a section drawn here, or a line in the lab's bar on what it is. */
const goTo = (ctx: Ctx, go: (place: Place) => void, drawn: readonly Id[]) => (id: Id) => {
  if (drawn.includes(id)) return go({ section: id, worker: null })
  const title = sectionText[id as keyof typeof sectionText]?.title ?? id
  ctx.say(ctx.pov === 'remote' && HOME_SECTIONS.includes(id) ? `${title}: studio’s, kept on studio` : `${title}, as it is`)
}

/** The side as it is, Computers after Pull requests. */
const asItIs = (ctx: Ctx, place: Place, go: (place: Place) => void, cards: ReactNode) => (
  <>
    {cards}
    <SettingsNav
      label="Settings"
      groups={[
        [section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
        [
          section('tasks'),
          section('pull-requests'),
          COMPUTERS,
          section('this-mac'),
          section('notifications'),
          section('appearance'),
          section('editor-and-browser'),
        ],
        [section('about')],
      ]}
      value={place.section}
      onChange={goTo(ctx, go, ['computers', 'this-mac'])}
    />
  </>
)

/** On studio, Computers is studio's. */
const lede = (ctx: Ctx) => (ctx.pov === 'remote' ? `Where ${ctx.home.name}’s agents run.` : undefined)

const page = (title: string, body: ReactNode, line?: string): Page => ({ title, ...(line === undefined ? {} : { lede: line }), body })

/** Work on this Mac, in every take. */
const macPage = (ctx: Ctx) => page(sectionText['this-mac'].title, <MacSection ctx={ctx} />)

/** The computer a place opens, where it is one. */
const openedOf = (ctx: Ctx, place: Place) => computersOf(ctx).find((one) => one.id === place.worker)

/* A · Tiles ---------------------------------------------------------------------------------------------- */

function Tiles({ ctx, open }: { ctx: Ctx; open: (id: string) => void }) {
  return (
    <div className={tt.section}>
      <TileGrid label={words.computers}>
        {computersOf(ctx).map((one) => (
          <div key={one.id} id={`worker-${one.id}`} className={tt.cell}>
            <ControlToggle
              className={tt.tile}
              title={one.name}
              line={<TileLine tone={one.offline !== null ? 'failed' : undefined}>{stateOf(ctx, one)}</TileLine>}
              on={takingOf(ctx, one)}
              onChange={setTakingOf(ctx, one)}
              glyph={<Icon name={iconOf(one)} size={16} />}
              onOpen={() => open(one.id)}
            />
          </div>
        ))}
        <AddTile onClick={ctx.add}>{words.add}</AddTile>
      </TileGrid>
    </div>
  )
}

export const A: Take = {
  key: 'a',
  kbd: 'a',
  label: 'Tiles',
  idea: 'A · Computers as MCP servers are: a tile each, its round switch takes new tasks, its name opens it out',
  at: (_ctx, worker) => ({ section: 'computers', worker }),
  side: asItIs,
  page: (ctx, place, go) => {
    if (place.section === 'this-mac') return macPage(ctx)
    if (place.section !== 'computers') return null
    const opened = openedOf(ctx, place)
    const back = () => go({ section: 'computers', worker: null })
    return page(
      words.computers,
      opened === undefined ? (
        <Tiles ctx={ctx} open={(id) => go({ section: 'computers', worker: id })} />
      ) : (
        <ComputerSheet ctx={ctx} worker={opened} onBack={back} taking={false} />
      ),
      lede(ctx),
    )
  },
}

/* B · Modules -------------------------------------------------------------------------------------------- */

/** A share as a short meter: its name, the kit's thin bar, the figure. */
function Meter({ name, share }: { name: string; share: number }) {
  return (
    <span className={x.meter}>
      <span className={x.meterName}>{name}</span>
      <SplitBar total={share} ours={0} />
      <span className={x.meterFigure}>{percent(share)}%</span>
    </span>
  )
}

/** A computer at a glance: how many of its agents work, what is off, how hard it works. */
function Glance({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const taking = takingOf(ctx, worker)
  if (worker.offline !== null)
    return (
      <span className={x.glanceBody}>
        <span className={`${x.count} ${x.danger}`}>Offline</span>
        <span className={x.glanceLine}>
          {worker.offline.for} · {words.holding(worker)}
        </span>
      </span>
    )
  const said = taking ? words.lowered(worker) : stateOf(ctx, worker)
  return (
    <span className={x.glanceBody}>
      <span className={x.countRow}>
        <span className={x.count}>{worker.agents.length}</span>
        <span className={x.of}>of {worker.configured} agents</span>
      </span>
      <span className={x.glanceLine}>{said ?? ' '}</span>
      <span className={x.meters}>
        <Meter name="CPU" share={worker.cpu} />
        <Meter name="Memory" share={worker.memory} />
      </span>
    </span>
  )
}

/** The home, wide: its trace beside CPU, Memory and Agents, as its popover draws them. */
function HomeGlance({ ctx, home }: { ctx: Ctx; home: Worker }) {
  return (
    <span className={x.hero}>
      <Readings worker={home} load={ctx.loadOf(home)} waiting={ctx.waiting.length} width={280} />
    </span>
  )
}

function Modules({ ctx, open }: { ctx: Ctx; open: (id: string) => void }) {
  const [home, ...rest] = computersOf(ctx)
  return (
    <ControlGrid columns={6} className={x.modules}>
      <ControlModule title={home!.name} aside={words.home} className={x.module} onClick={() => open(home!.id)}>
        <HomeGlance ctx={ctx} home={home!} />
      </ControlModule>
      {rest.map((one) => (
        <ControlModule
          key={one.id}
          id={`worker-${one.id}`}
          title={one.name}
          className={`${x.module} ${x.third}`}
          onClick={() => open(one.id)}
        >
          <Glance ctx={ctx} worker={one} />
        </ControlModule>
      ))}
      <AddTile onClick={ctx.add} className={x.addModule}>
        {words.add}
      </AddTile>
    </ControlGrid>
  )
}

export const B: Take = {
  key: 'b',
  kbd: 'b',
  label: 'Modules',
  idea: 'B · Computers as the quick settings are, each as large as it matters: the home wide with its trace, the others under it',
  at: (_ctx, worker) => ({ section: 'computers', worker }),
  side: asItIs,
  page: (ctx, place, go) => {
    if (place.section === 'this-mac') return macPage(ctx)
    if (place.section !== 'computers') return null
    const opened = openedOf(ctx, place)
    return page(
      words.computers,
      opened === undefined ? (
        <Modules ctx={ctx} open={(id) => go({ section: 'computers', worker: id })} />
      ) : (
        <ComputerSheet ctx={ctx} worker={opened} onBack={() => go({ section: 'computers', worker: null })} />
      ),
      lede(ctx),
    )
  },
}

/* C · Home first ----------------------------------------------------------------------------------------- */

/** The home at the top of the side, as a card: its name, and where it is; pressed, its own page. */
function HomeCard({ ctx, place, go }: { ctx: Ctx; place: Place; go: (place: Place) => void }) {
  const home = ctx.home
  return (
    <button
      type="button"
      className={x.homeCard}
      aria-current={place.section === 'home' ? 'page' : undefined}
      onClick={() => go({ section: 'home', worker: null })}
    >
      <span className={x.homeGlyph}>
        <Icon name={home.here ? 'computer' : 'home'} size={16} />
      </span>
      <span className={x.homeWords}>
        <span className={x.homeName}>{home.name}</span>
        <span className={x.homeLine}>{home.here ? words.home : home.address}</span>
      </span>
    </button>
  )
}

/** A computer as a row: its picture, its name and where it stands, how many of its agents work. */
function Row({ ctx, worker, open }: { ctx: Ctx; worker: Worker; open: () => void }) {
  const taking = takingOf(ctx, worker)
  const line =
    worker.offline !== null ? (
      <span className={x.danger}>
        {words.away(worker)} · {words.holding(worker)}
      </span>
    ) : !taking ? (
      stateOf(ctx, worker)
    ) : (
      (words.lowered(worker) ?? words.load(worker))
    )
  return (
    <button type="button" id={`worker-${worker.id}`} className={x.row} onClick={open}>
      <span className={`${x.rowIcon} ${worker.offline === null ? '' : x.danger}`}>
        <Icon name={iconOf(worker)} size={15} />
      </span>
      <span className={x.rowWords}>
        <span className={x.rowName}>{worker.name}</span>
        <span className={x.rowLine}>{line}</span>
      </span>
      <span className={x.rowFigure}>{worker.offline === null && taking ? words.of(worker) : ''}</span>
      <Icon name="chevron" size={12} className={x.rowChevron} />
    </button>
  )
}

function Rows({ ctx, open }: { ctx: Ctx; open: (id: string) => void }) {
  const rest = computersOf(ctx).filter((one) => !one.home)
  return (
    <div className={`${tt.sheet} ${x.rows}`}>
      {rest.map((one) => (
        <Row key={one.id} ctx={ctx} worker={one} open={() => open(one.id)} />
      ))}
      <button type="button" className={`${x.row} ${x.addRow}`} onClick={ctx.add}>
        <span className={x.rowIcon}>
          <Icon name="plus" size={15} />
        </span>
        <span className={x.rowName}>{words.add}</span>
      </button>
    </div>
  )
}

export const C: Take = {
  key: 'c',
  kbd: 'c',
  label: 'Home first',
  idea: 'C · Settings under the home: its own page at the top of the side; on studio, This Mac’s own apart under its name',
  at: (ctx, worker) =>
    worker === null || worker === ctx.home.id
      ? { section: worker === null ? 'computers' : 'home', worker: null }
      : { section: 'computers', worker },
  side: (ctx, place, go, cards) => {
    const onChange = goTo(ctx, go, ['computers', 'this-mac'])
    if (ctx.pov === 'local')
      return (
        <>
          <HomeCard ctx={ctx} place={place} go={go} />
          {cards}
          <SettingsNav
            label="Settings"
            groups={[
              [COMPUTERS, section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
              [
                section('tasks'),
                section('pull-requests'),
                section('this-mac'),
                section('notifications'),
                section('appearance'),
                section('editor-and-browser'),
              ],
              [section('about')],
            ]}
            value={place.section}
            onChange={onChange}
          />
        </>
      )
    return (
      <>
        <HomeCard ctx={ctx} place={place} go={go} />
        <SettingsNav
          label={`${ctx.home.name}’s settings`}
          groups={[
            [COMPUTERS, section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
            [section('tasks'), section('pull-requests')],
          ]}
          value={place.section}
          onChange={onChange}
        />
        <span className={x.partHead}>
          <Icon name="computer" size={12} />
          This Mac
        </span>
        {cards}
        <SettingsNav
          label="This Mac’s settings"
          groups={[
            [section('this-mac'), section('notifications'), section('appearance'), section('editor-and-browser')],
            [section('about')],
          ]}
          value={place.section}
          onChange={onChange}
        />
      </>
    )
  },
  page: (ctx, place, go) => {
    if (place.section === 'this-mac') return macPage(ctx)
    if (place.section === 'home') return page(ctx.home.name, <ComputerBody ctx={ctx} worker={ctx.home} />, words.home)
    if (place.section !== 'computers') return null
    const opened = openedOf(ctx, place)
    return page(
      words.computers,
      opened === undefined ? (
        <Rows ctx={ctx} open={(id) => go({ section: 'computers', worker: id })} />
      ) : (
        <ComputerSheet ctx={ctx} worker={opened} onBack={() => go({ section: 'computers', worker: null })} />
      ),
      ctx.pov === 'remote'
        ? `Where ${ctx.home.name}’s agents run, besides ${ctx.home.name} itself.`
        : 'Where your agents run, besides This Mac.',
    )
  },
}

export const TAKES: readonly Take[] = [A, B, C]
