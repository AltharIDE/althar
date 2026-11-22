import type { ReactNode } from 'react'
import { Icon, LinkButton, SettingGroup, SettingsNav, type SettingsSection } from '@althar/ui'

import { AddTile } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import cc from '../../../../../packages/ui/src/setup/ControlCenter/ControlCenter.module.css'
import { percent } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import { sectionText } from '../../../src/renderer/features/settings/sections'
import type { Kind, Worker } from '../data'
import { Glyph } from '../glyph'
import { HostedReadings, Readings, Reading, SplitBar } from '../parts'
import type { Ctx, Label, Page, Place, Take } from '../types'
import { words } from '../words'
import { ComputerSheet, computersOf, MacSection, RunnersSheet, Runs, stateOf, takingOf } from './pieces'
import x from './settings.module.css'

/*
 * Settings › Computers as B drew it, the one picked: modules, each as large
 * as it matters, the home wide with its trace and the others under it. The
 * takes are how it tells them apart, the home above all:
 *
 * A · Words: a word over each name says what it is. The home's says Home,
 *     in ink, with a house; the rest say Linux server, Mac mini, Althar Cloud.
 * B · Sections: headings group them, as Settings groups its rows: Home,
 *     Your computers, Althar Cloud. Each module keeps to its name.
 * C · Pictures: a round picture of what each is beside its name, as the
 *     quick settings' cards have; the home's is a house, in ink.
 *
 * In every take: on studio or a home hosted in Althar Cloud (1 2 3), and with
 * the home's cloud runners or not (U). A computer opens out in place.
 */

export const TAKES: readonly Take[] = [
  {
    key: 'a',
    kbd: 'a',
    label: 'Words',
    style: 'words',
    idea: 'A · A word over each name says what it is: Home in ink, then Linux server, Mac mini, Althar Cloud',
  },
  { key: 'b', kbd: 'b', label: 'Sections', style: 'sections', idea: 'B · Headings group them: Home, Your computers, Althar Cloud' },
  {
    key: 'c',
    kbd: 'c',
    label: 'Pictures',
    style: 'pictures',
    idea: 'C · A round picture of what each is beside its name; the home’s a house, in ink',
  },
]

/* ---- the side and the page ---- */

type Id = string
const section = (id: keyof typeof sectionText): SettingsSection<Id> => ({ id, ...sectionText[id] })
const COMPUTERS: SettingsSection<Id> = { id: 'computers', title: words.computers, icon: 'computer' }

/** The home's sections: what it keeps, wherever the window is. */
const HOME_SECTIONS: readonly Id[] = ['agents', 'mcp-servers', 'skills', 'code-hosts', 'tasks', 'pull-requests']
const DRAWN: readonly Id[] = ['computers', 'this-mac']

/** Where Settings opens: Computers, on a computer where one is given. */
export const at = (worker: string | null): Place => ({ section: 'computers', worker })

/** The side as it is, Computers after Pull requests; a press on a section the lab doesn't draw says what it is. */
export const side = (ctx: Ctx, place: Place, go: (place: Place) => void, cards: ReactNode) => (
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
      onChange={(id) => {
        if (DRAWN.includes(id)) return go({ section: id, worker: null })
        const title = sectionText[id as keyof typeof sectionText]?.title ?? id
        ctx.say(ctx.pov !== 'local' && HOME_SECTIONS.includes(id) ? `${title}: ${ctx.home.name}’s, kept there` : `${title}, as it is`)
      }}
    />
  </>
)

const page = (title: string, body: ReactNode, lede?: string): Page => ({ title, ...(lede === undefined ? {} : { lede }), body })

/** Connected to a home, Computers is that home's. */
const ledeOf = (ctx: Ctx) => (ctx.pov === 'local' ? undefined : `Where ${ctx.home.name}’s agents run.`)

/** The section open: Computers, a computer or the runners opened out in it, or Work on this Mac. */
export function pageOf(ctx: Ctx, style: Label, place: Place, go: (place: Place) => void): Page | null {
  if (place.section === 'this-mac') return page(sectionText['this-mac'].title, <MacSection ctx={ctx} />)
  if (place.section !== 'computers') return null
  const back = () => go(at(null))
  const lede = ledeOf(ctx)
  if (place.worker === RUNNERS && ctx.runners !== null) return page(words.computers, <RunnersSheet ctx={ctx} onBack={back} />, lede)
  const opened = computersOf(ctx).find((one) => one.id === place.worker)
  if (opened !== undefined) return page(words.computers, <ComputerSheet ctx={ctx} worker={opened} onBack={back} />, lede)
  return page(words.computers, <Computers ctx={ctx} style={style} open={(id) => go(at(id))} />, lede)
}

/* ---- a module, told apart as the take does ---- */

/** The runners' place, as a computer's id would be. */
export const RUNNERS = 'runners'

/** What a module's head says of what it holds: its name, the home or not, what it is, out of reach or not; under a heading, what the heading doesn't say. */
interface Who {
  name: string
  home: boolean
  kind: Kind
  model: string
  away: boolean
  aside: string
}
const whoOf = (worker: Worker): Who => ({
  name: worker.name,
  home: worker.home,
  kind: worker.kind,
  model: worker.model,
  away: worker.offline !== null,
  aside: worker.model,
})
const runnersWho = (ctx: Ctx): Who => ({
  name: words.runners,
  home: false,
  kind: 'cloud',
  model: words.cloud,
  away: false,
  aside: ctx.runners!.region,
})

function Head({ style, who }: { style: Label; who: Who }) {
  const chevron = <Icon name="chevron" size={11} className={x.chevron} />
  if (style === 'words')
    return (
      <span className={x.head}>
        <span className={x.names}>
          {who.home ? (
            <span className={`${x.eyebrow} ${x.eyebrowHome}`}>
              <Glyph kind="home" size={12} />
              {words.home}
              <span className={x.eyebrowRest}>· {who.model}</span>
            </span>
          ) : (
            <span className={x.eyebrow}>{who.model}</span>
          )}
          <span className={x.name}>{who.name}</span>
        </span>
        {chevron}
      </span>
    )
  if (style === 'pictures')
    return (
      <span className={x.head}>
        <span className={`${x.picture} ${who.home ? x.pictureHome : ''} ${who.away ? x.pictureAway : ''}`}>
          {who.home ? <Glyph kind="home" size={16} /> : who.away ? <Icon name="unlinked" size={15} /> : <Glyph kind={who.kind} size={16} />}
        </span>
        <span className={x.names}>
          <span className={x.name}>{who.name}</span>
          <span className={x.kindLine}>
            {who.home ? (
              <>
                <span className={x.homeWord}>{words.home}</span> · {who.model}
              </>
            ) : (
              who.model
            )}
          </span>
        </span>
        {chevron}
      </span>
    )
  return (
    <span className={x.head}>
      <span className={x.names}>
        <span className={x.name}>{who.name}</span>
      </span>
      <span className={x.aside}>{who.aside}</span>
      {chevron}
    </span>
  )
}

/** One of the kit's modules, on the page's paper, its head told apart as the take does. */
function Module({
  style,
  who,
  wide = false,
  id,
  onClick,
  children,
}: {
  style: Label
  who: Who
  wide?: boolean
  id: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" id={id} className={`${cc.module} ${cc.opens} ${x.module} ${wide ? '' : x.third}`} onClick={onClick}>
      <Head style={style} who={who} />
      {children}
    </button>
  )
}

/* ---- what each module shows ---- */

/** A share as a short meter: its name, the kit's thin bar, the figure. */
function Meter({ name, share }: { name: string; share: number }) {
  return (
    <span className={x.meter}>
      <span>{name}</span>
      <SplitBar total={share} ours={0} />
      <span className={x.meterFigure}>{percent(share)}%</span>
    </span>
  )
}

/** Another computer at a glance: how many of its agents work, what is off where something is, how hard it works. */
function Glance({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  if (worker.offline !== null)
    return (
      <span className={x.stats}>
        <span className={`${x.count} ${x.danger}`}>Offline</span>
        <span className={x.line}>
          {worker.offline.for} · {words.holding(worker)}
        </span>
      </span>
    )
  const said = takingOf(ctx, worker) ? words.lowered(worker) : stateOf(ctx, worker)
  return (
    <span className={x.stats}>
      <span className={x.countRow}>
        <span className={x.count}>{worker.agents.length}</span>
        <span className={x.of}>of {worker.configured} agents</span>
      </span>
      {said !== null && <span className={x.line}>{said}</span>}
      <span className={x.meters}>
        <Meter name="CPU" share={worker.cpu} />
        <Meter name="Memory" share={worker.memory} />
      </span>
    </span>
  )
}

/** The home, wide: its trace beside CPU, Memory and Agents, as its popover draws them; hosted, always on beside its agents and storage. */
function HomeGlance({ ctx, home }: { ctx: Ctx; home: Worker }) {
  return (
    <span className={`${x.hero} ${x.readingsAlong}`}>
      {home.hosted !== null ? (
        <HostedReadings ctx={ctx} worker={home} region={false} />
      ) : (
        <Readings worker={home} load={ctx.loadOf(home)} waiting={ctx.waiting.length} width={240} />
      )}
    </span>
  )
}

/** The runners, wide: how many run of their number and how they start, what they run, this month's spend. */
function RunnersGlance({ ctx }: { ctx: Ctx }) {
  const runners = ctx.runners!
  return (
    <span className={x.hero}>
      <span className={x.stats}>
        <span className={x.countRow}>
          <span className={x.count}>{runners.running.length}</span>
          <span className={x.of}>{words.runnersOf(runners)}</span>
        </span>
        <span className={x.line}>{words.starts(runners)}</span>
      </span>
      <Runs ctx={ctx} most={3} />
      <Reading
        name={words.thisMonth}
        figure={words.spend(runners)}
        share={runners.limit === null ? 0 : runners.spent / runners.limit}
        note={words.resets}
      />
    </span>
  )
}

/* ---- Computers ---- */

function Computers({ ctx, style, open }: { ctx: Ctx; style: Label; open: (id: string) => void }) {
  const [home, ...rest] = computersOf(ctx)
  // Hosted, the runners are where its agents run: next to it. Otherwise they take what would wait: last.
  const cloudFirst = ctx.pov === 'cloud'
  const homeModule = (
    <Module style={style} who={whoOf(home!)} wide id={`worker-${home!.id}`} onClick={() => open(home!.id)}>
      <HomeGlance ctx={ctx} home={home!} />
    </Module>
  )
  const others = rest.map((one) => (
    <Module key={one.id} style={style} who={whoOf(one)} id={`worker-${one.id}`} onClick={() => open(one.id)}>
      <Glance ctx={ctx} worker={one} />
    </Module>
  ))
  const runners =
    ctx.runners === null ? null : (
      <Module style={style} who={runnersWho(ctx)} wide id={`worker-${RUNNERS}`} onClick={() => open(RUNNERS)}>
        <RunnersGlance ctx={ctx} />
      </Module>
    )
  const add = (
    <AddTile onClick={ctx.add} className={x.add}>
      {words.add}
    </AddTile>
  )

  if (style === 'sections') {
    const cloud =
      runners === null ? null : (
        <SettingGroup title={words.cloud}>
          <div className={x.grid}>{runners}</div>
        </SettingGroup>
      )
    return (
      <div className={x.computers}>
        <SettingGroup title={words.home}>
          <div className={x.grid}>{homeModule}</div>
        </SettingGroup>
        {cloudFirst && cloud}
        <SettingGroup title={words.yours} {...(rest.length > 0 ? { action: <LinkButton onClick={ctx.add}>{words.add}</LinkButton> } : {})}>
          <div className={x.grid}>{rest.length > 0 ? others : add}</div>
        </SettingGroup>
        {!cloudFirst && cloud}
      </div>
    )
  }
  return (
    <div className={x.computers}>
      <div className={x.grid}>
        {homeModule}
        {cloudFirst && runners}
        {others}
        {add}
        {!cloudFirst && runners}
      </div>
    </div>
  )
}
