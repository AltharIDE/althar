import type { ReactNode } from 'react'
import { Icon, LinkButton, SettingGroup, SettingsNav, type SettingsSection } from '@althar/ui'

import { AddTile } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import cc from '../../../../../packages/ui/src/setup/ControlCenter/ControlCenter.module.css'
import { percent } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import { sectionText } from '../../../src/renderer/features/settings/sections'
import type { Worker } from '../data'
import { Glyph, type Picture, pictureOf } from '../glyph'
import { across, HostedReadings, Reading, Readings, SpendReading, SplitBar } from '../parts'
import type { Ctx, Page, Place, Take } from '../types'
import { words } from '../words'
import { CloudSheet, Controls, Daily, Leave, Runs, Stats } from './cloud'
import { ComputerSheet, computersOf, MacSection, stateOf, takingOf } from './pieces'
import x from './settings.module.css'

/*
 * Settings › Computers as picked: sections (Home, Workers, Cloud), a module
 * each, each with a round picture of what it is: the home a house in ink,
 * every worker the same computer (H tells headless ones apart), the cloud a
 * cloud. The takes are where Althar Cloud's use and limit live, as a control
 * panel rather than a computer: no runner count, no sizes or versions.
 *
 * A · Module: a wide module like the home's, this month's spend and what runs
 *     now; it opens out to its figures and its two controls.
 * B · Panel: the control panel on the page, nothing to open: this month's
 *     figures, each day's spend, what runs now, its controls.
 * C · Own page: Althar Cloud a section of Settings of its own; Computers
 *     keeps a line for it.
 *
 * Hosted in Althar Cloud (3), the home is the cloud: the take's form of it
 * stands under Home, always on.
 */

export const TAKES: readonly Take[] = [
  {
    key: 'a',
    kbd: 'a',
    label: 'Module',
    cloud: 'module',
    idea: 'A · Althar Cloud a wide module: this month’s spend and what runs now; it opens to its figures and limit',
  },
  {
    key: 'b',
    kbd: 'b',
    label: 'Panel',
    cloud: 'panel',
    idea: 'B · Althar Cloud’s control panel on the page: this month, each day, what runs, its limit',
  },
  {
    key: 'c',
    kbd: 'c',
    label: 'Own page',
    cloud: 'page',
    idea: 'C · Althar Cloud a section of Settings of its own; Computers keeps a line for it',
  },
]

/* ---- the side and the page ---- */

type Id = string
const section = (id: keyof typeof sectionText): SettingsSection<Id> => ({ id, ...sectionText[id] })
const COMPUTERS: SettingsSection<Id> = { id: 'computers', title: words.computers, icon: 'computer' }
/** C's own section; the kit has no cloud yet, so a globe stands in. */
const CLOUD: SettingsSection<Id> = { id: 'cloud', title: words.cloud, icon: 'globe' }

/** The home's sections: what it keeps, wherever the window is. */
const HOME_SECTIONS: readonly Id[] = ['agents', 'mcp-servers', 'skills', 'code-hosts', 'tasks', 'pull-requests']
const DRAWN: readonly Id[] = ['computers', 'cloud', 'this-mac']

/** The cloud's place, as a computer's id would be. */
export const RUNNERS = 'cloud'

/** Where Settings opens: Computers, on a computer where one is given; in C, the cloud on its own page. */
export const at = (worker: string | null, take?: Take): Place =>
  take?.cloud === 'page' && worker === RUNNERS ? { section: 'cloud', worker: null } : { section: 'computers', worker }

/** C has Althar Cloud a section of its own, after Computers, where the home uses it. */
const ownPage = (ctx: Ctx, take: Take) => take.cloud === 'page' && ctx.runners !== null

/** The side as it is, Computers after Pull requests; a press on a section the lab doesn't draw says what it is. */
export const side = (ctx: Ctx, take: Take, place: Place, go: (place: Place) => void, cards: ReactNode) => (
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
          ...(ownPage(ctx, take) ? [CLOUD] : []),
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

/** The section open: Computers, a computer or the cloud opened out in it, the cloud's own page, or Work on this Mac. */
export function pageOf(ctx: Ctx, take: Take, place: Place, go: (place: Place) => void): Page | null {
  if (place.section === 'this-mac') return page(sectionText['this-mac'].title, <MacSection ctx={ctx} />)
  const hosted = ctx.home.hosted !== null
  // Opened from Computers, it has a way back there; from the side, it is a section like any other.
  const backTo = place.from === 'computers' ? () => go(at(null)) : null
  if (place.section === 'cloud')
    return ownPage(ctx, take) ? page(words.cloud, <CloudPage ctx={ctx} hosted={hosted} onBack={backTo} />) : null
  if (place.section !== 'computers') return null
  const back = () => go(at(null))
  const lede = ledeOf(ctx)
  const cloudOpened = ctx.runners !== null && (place.worker === RUNNERS || (hosted && place.worker === ctx.home.id))
  if (cloudOpened && take.cloud === 'module') return page(words.computers, <CloudSheet ctx={ctx} hosted={hosted} onBack={back} />, lede)
  const opened = computersOf(ctx).find((one) => one.id === place.worker && one.hosted === null)
  if (opened !== undefined) return page(words.computers, <ComputerSheet ctx={ctx} worker={opened} onBack={back} />, lede)
  return page(words.computers, <Computers ctx={ctx} take={take} open={(id) => go({ ...at(id, take), from: 'computers' })} />, lede)
}

/* ---- a module's head: a picture, its name, a line under it ---- */

interface Who {
  name: string
  picture: Picture
  line: ReactNode
  away: boolean
}

const whoOf = (ctx: Ctx, worker: Worker): Who => ({
  name: worker.name,
  picture: pictureOf(worker, ctx.twoKinds),
  line: worker.model,
  away: worker.offline !== null,
})

const cloudWho = (ctx: Ctx): Who => ({ name: words.cloud, picture: 'cloud', line: words.takes(ctx.runners!), away: false })

/** The head: the round picture, the home's in ink and one out of reach in red; its name and a line; what it has at the end. */
function Head({ who, end, chevron = true }: { who: Who; end?: ReactNode; chevron?: boolean }) {
  return (
    <span className={x.head}>
      <span className={`${x.picture} ${who.picture === 'home' ? x.pictureHome : ''} ${who.away ? x.pictureAway : ''}`}>
        <Glyph kind={who.picture} size={16} />
      </span>
      <span className={x.names}>
        <span className={x.name}>{who.name}</span>
        <span className={x.kindLine}>{who.line}</span>
      </span>
      {end}
      {chevron && <Icon name="chevron" size={11} className={x.chevron} />}
    </span>
  )
}

/** One of the kit's modules, on the page's paper: a third of the row, or the whole of it. */
function Module({
  who,
  wide = false,
  id,
  onClick,
  children,
}: {
  who: Who
  wide?: boolean
  id: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button type="button" id={id} className={`${cc.module} ${cc.opens} ${x.module} ${wide ? '' : x.third}`} onClick={onClick}>
      <Head who={who} />
      {children}
    </button>
  )
}

/* ---- the home and the workers ---- */

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

/** A worker at a glance: how many of its agents work, what is off where something is, how hard it works. */
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

/* ---- Althar Cloud, as each take has it ---- */

/** A: wide, as the home is: this month's spend against the limit, what runs now, hours and tasks; hosted, its agents too. */
function CloudGlance({ ctx, hosted }: { ctx: Ctx; hosted: boolean }) {
  const runners = ctx.runners!
  return (
    <span className={x.hero}>
      <span className={x.stats}>
        <span className={x.countRow}>
          <span className={x.count}>{words.dollars(runners.spent)}</span>
          <span className={x.of}>
            {runners.limit === null ? words.thisMonth.toLowerCase() : `of ${words.dollars(runners.limit)} this month`}
          </span>
        </span>
        {runners.limit !== null && <SplitBar total={runners.spent / runners.limit} ours={0} />}
        <span className={x.line}>{words.outlook(runners)}</span>
      </span>
      <Runs ctx={ctx} most={3} />
      <span className={x.readingList}>
        {hosted && <Reading name={words.agents} figure={words.atWork(across(ctx))} />}
        <Reading name={words.hours} figure={words.hoursFigure(runners)} />
        <Reading name={words.tasksRun} figure={String(runners.tasks)} />
      </span>
    </span>
  )
}

/** B: the control panel itself, on the page: its head, this month's figures, each day, what runs now, its controls. */
function CloudPanel({ ctx, who, hosted }: { ctx: Ctx; who: Who; hosted: boolean }) {
  return (
    <section className={x.panel} aria-label={who.name}>
      <Head who={who} chevron={false} end={<span className={x.aside}>{words.resets}</span>} />
      <Stats runners={ctx.runners!} />
      <Daily runners={ctx.runners!} />
      <span className={x.panelRuns}>
        <span className={x.eyebrow}>{words.runningNow}</span>
        <Runs ctx={ctx} />
      </span>
      <span className={x.panelControls}>
        <Controls ctx={ctx} hosted={hosted} />
      </span>
      {!hosted && (
        <span className={x.panelFoot}>
          <Leave ctx={ctx} hosted={hosted} />
        </span>
      )}
    </section>
  )
}

/** C: a line in Computers, this month's spend at its end, opening Althar Cloud's own page. */
function CloudLine({ ctx, who, onClick }: { ctx: Ctx; who: Who; onClick: () => void }) {
  return (
    <button type="button" className={`${cc.module} ${cc.opens} ${x.module} ${x.lineModule}`} onClick={onClick}>
      <Head
        who={who}
        end={
          <span className={x.lineSpend}>
            <SpendReading runners={ctx.runners!} />
          </span>
        }
      />
    </button>
  )
}

/** C's own page: this month and each day, what runs now, when it runs; leaving it at the foot. */
function CloudPage({ ctx, hosted, onBack }: { ctx: Ctx; hosted: boolean; onBack: (() => void) | null }) {
  const runners = ctx.runners!
  return (
    <div className={x.computers}>
      {onBack !== null && (
        <button type="button" className={x.backTo} onClick={onBack}>
          <span className={x.backChevron} aria-hidden="true">
            <Icon name="chevron" size={11} />
          </span>
          {words.computers}
        </button>
      )}
      <SettingGroup className={x.group} title={words.thisMonth} note={`${words.resets} · ${words.rateFigure}`}>
        <span className={x.pageUse}>
          <Stats runners={runners} spentName={words.spent} />
          <Daily runners={runners} />
        </span>
      </SettingGroup>
      <SettingGroup className={x.group} title={words.runningNow}>
        <Runs ctx={ctx} />
      </SettingGroup>
      <SettingGroup className={x.group} title="When it runs">
        <Controls ctx={ctx} hosted={hosted} />
      </SettingGroup>
      <Leave ctx={ctx} hosted={hosted} />
    </div>
  )
}

/* ---- Computers ---- */

function Computers({ ctx, take, open }: { ctx: Ctx; take: Take; open: (id: string) => void }) {
  const [home, ...rest] = computersOf(ctx)
  const hosted = home!.hosted !== null
  const cloud = ctx.runners !== null

  /** Althar Cloud in the take's form; hosted, as the home. */
  const cloudItem = (who: Who, id: string) => {
    if (take.cloud === 'panel') return <CloudPanel ctx={ctx} who={who} hosted={hosted} />
    if (take.cloud === 'page') {
      if (!hosted) return <CloudLine ctx={ctx} who={who} onClick={() => open(RUNNERS)} />
      return (
        <Module who={who} wide id={`worker-${id}`} onClick={() => open(RUNNERS)}>
          <span className={`${x.hero} ${x.readingsAlong}`}>
            <HostedReadings ctx={ctx} status={false} />
          </span>
        </Module>
      )
    }
    return (
      <Module who={who} wide id={`worker-${id}`} onClick={() => open(id)}>
        <CloudGlance ctx={ctx} hosted={hosted} />
      </Module>
    )
  }

  const homeItem =
    hosted && cloud ? (
      cloudItem({ ...whoOf(ctx, home!), line: words.alwaysOn }, home!.id)
    ) : (
      <Module who={whoOf(ctx, home!)} wide id={`worker-${home!.id}`} onClick={() => open(home!.id)}>
        <span className={`${x.hero} ${x.readingsAlong}`}>
          <Readings worker={home!} load={ctx.loadOf(home!)} waiting={ctx.waiting.length} width={240} />
        </span>
      </Module>
    )
  const workers = rest.map((one) => (
    <Module key={one.id} who={whoOf(ctx, one)} id={`worker-${one.id}`} onClick={() => open(one.id)}>
      <Glance ctx={ctx} worker={one} />
    </Module>
  ))

  return (
    <div className={x.computers}>
      <SettingGroup className={x.group} title={words.home}>
        <div className={x.grid}>{homeItem}</div>
      </SettingGroup>
      <SettingGroup
        className={x.group}
        title={words.workers}
        {...(rest.length > 0 ? { action: <LinkButton onClick={ctx.add}>{words.add}</LinkButton> } : {})}
      >
        <div className={x.grid}>
          {rest.length > 0 ? (
            workers
          ) : (
            <AddTile onClick={ctx.add} className={x.add}>
              {words.add}
            </AddTile>
          )}
        </div>
      </SettingGroup>
      {cloud && !hosted && (
        <SettingGroup className={x.group} title={words.cloudGroup}>
          <div className={x.grid}>{cloudItem(cloudWho(ctx), RUNNERS)}</div>
        </SettingGroup>
      )}
    </div>
  )
}
