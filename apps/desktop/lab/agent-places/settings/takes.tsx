import { Icon, SettingsNav, type SettingsSection } from '@althar/ui'

import { sectionText } from '../../../src/renderer/features/settings/sections'
import type { Ctx, Page, Place, Take } from '../types'
import { words } from '../words'
import { MacList, WorkerPage, WorkersList } from './pieces'
import x from './settings.module.css'

/*
 * Three takes on Settings once the home has workers, from this computer's
 * own home or from one the window is connected to (studio). Work on this Mac
 * holds this Mac only, in all three.
 *
 * A · one section, Workers: the home first, then each worker, a row with its
 *     health that opens in place to what it is and its settings.
 * B · a page each: the side lists the computers, the home first and This Mac
 *     last, each a page of its readings, what it is and its settings; Work on
 *     this Mac becomes This Mac's page.
 * C · two sides: the side splits into the home's settings, Workers among
 *     them, and This Mac's own, so what a remote home changes is what's under
 *     its name.
 */

type Id = string
const section = (id: keyof typeof sectionText): SettingsSection<Id> => ({ id, ...sectionText[id] })
const WORKERS: SettingsSection<Id> = { id: 'workers', title: words.workers, icon: 'computer' }

/** Where a press on the side goes: a section drawn here, or a line in the lab's bar on what it is. */
const goTo = (ctx: Ctx, go: (place: Place) => void, drawn: readonly Id[], home: readonly Id[]) => (id: Id) => {
  if (drawn.includes(id)) return go({ section: id, worker: null })
  const title = sectionText[id as keyof typeof sectionText]?.title ?? id
  ctx.say(ctx.pov === 'remote' && home.includes(id) ? `${title}, as it is: studio’s, kept on studio` : `${title}, as it is`)
}

/** The home's sections: what it keeps, wherever the window is. */
const HOME_SECTIONS: readonly Id[] = ['agents', 'mcp-servers', 'skills', 'code-hosts', 'tasks', 'pull-requests', 'workers']

/* A · one section ---------------------------------------------------------------------------------------- */

export const A: Take = {
  key: 'a',
  kbd: 'a',
  label: 'Workers section',
  idea: 'A · Workers: the home first, then each worker, a row with its health, opening in place to what it is and its settings',
  at: (_ctx, worker) => ({ section: 'workers', worker }),
  side: (ctx, place, go) => (
    <SettingsNav
      label="Settings"
      groups={[
        [section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
        [
          section('tasks'),
          section('pull-requests'),
          section('this-mac'),
          WORKERS,
          section('notifications'),
          section('appearance'),
          section('editor-and-browser'),
        ],
        [section('about')],
      ]}
      value={place.section}
      onChange={goTo(ctx, go, ['workers', 'this-mac'], HOME_SECTIONS)}
    />
  ),
  page: (ctx, place, go): Page | null => {
    if (place.section === 'this-mac')
      return { title: sectionText['this-mac'].title, body: <MacList ctx={ctx} pauseAll={ctx.pov === 'local'} lend={false} /> }
    if (place.section !== 'workers') return null
    return {
      title: words.workers,
      ...(ctx.pov === 'remote' ? { lede: `${ctx.home.name}, the home this window is on, and the computers that run its tasks.` } : {}),
      body: (
        <WorkersList
          ctx={ctx}
          opened={place.worker}
          onOpen={(worker) => go({ section: 'workers', worker })}
          pauseAll={ctx.pov === 'remote'}
        />
      ),
    }
  },
}

/* B · a page each ---------------------------------------------------------------------------------------- */

/** The computers, the home first, This Mac last where it isn't the home, then Add a worker. */
const computers = (ctx: Ctx): SettingsSection<Id>[] => {
  const listed = ctx.workers.some((one) => one.here) ? ctx.workers : [...ctx.workers, ctx.mac]
  const ordered = [...listed.filter((one) => !one.here || one.home), ...listed.filter((one) => one.here && !one.home)]
  return [
    ...ordered.map((one) => ({
      id: `w:${one.id}`,
      title: one.name,
      icon: one.home && !one.here ? ('home' as const) : one.offline !== null ? ('unlinked' as const) : ('computer' as const),
    })),
    { id: 'add', title: words.add, icon: 'plus' as const },
  ]
}

export const B: Take = {
  key: 'b',
  kbd: 'b',
  label: 'A page each',
  idea: 'B · The side lists the computers, the home first and This Mac last; each a page of its readings, what it is and its settings',
  at: (ctx, worker) => ({ section: `w:${worker ?? ctx.home.id}`, worker: null }),
  side: (ctx, place, go) => (
    <SettingsNav
      label="Settings"
      groups={[
        [section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
        [section('tasks'), section('pull-requests'), section('notifications'), section('appearance'), section('editor-and-browser')],
        computers(ctx),
        [section('about')],
      ]}
      value={place.section}
      onChange={(id) => {
        if (id === 'add') return ctx.add()
        if (id.startsWith('w:')) return go({ section: id, worker: null })
        goTo(ctx, go, [], HOME_SECTIONS)(id)
      }}
    />
  ),
  page: (ctx, place): Page | null => {
    if (!place.section.startsWith('w:')) return null
    const id = place.section.slice(2)
    const worker = [...ctx.workers, ctx.mac].find((one) => one.id === id)
    if (worker === undefined) return null
    const lede = worker.home
      ? `${words.home} · ${worker.here ? 'keeps your projects and runs the coordinator' : `${worker.address}`}`
      : worker.here
        ? 'This window'
        : undefined
    return { title: worker.name, ...(lede === undefined ? {} : { lede }), body: <WorkerPage ctx={ctx} worker={worker} /> }
  },
}

/* C · two sides ------------------------------------------------------------------------------------------ */

export const C: Take = {
  key: 'c',
  kbd: 'c',
  label: 'Home and This Mac',
  idea: 'C · The side in two: the home’s settings, Workers among them, under its name; This Mac’s own under it',
  at: (_ctx, worker) => ({ section: 'workers', worker }),
  side: (ctx, place, go) => {
    const onChange = goTo(ctx, go, ['workers', 'this-mac'], HOME_SECTIONS)
    return (
      <div className={x.split}>
        <div className={x.part}>
          <span className={x.partHead}>
            <Icon name="home" size={12} />
            <span className={x.partName}>{ctx.pov === 'local' ? 'This computer' : ctx.home.name}</span>
            {ctx.pov === 'remote' && <span className={x.partQuiet}>Home</span>}
          </span>
          <SettingsNav
            label={`${ctx.home.name}’s settings`}
            groups={[
              [section('agents'), section('mcp-servers'), section('skills'), section('code-hosts')],
              [section('tasks'), section('pull-requests'), WORKERS],
            ]}
            value={place.section}
            onChange={onChange}
          />
        </div>
        <div className={x.part}>
          <span className={x.partHead}>
            <Icon name="computer" size={12} />
            <span className={x.partName}>This Mac</span>
          </span>
          <SettingsNav
            label="This Mac’s settings"
            groups={[
              [
                { ...section('this-mac'), title: 'This Mac' },
                section('notifications'),
                section('appearance'),
                section('editor-and-browser'),
              ],
            ]}
            value={place.section}
            onChange={onChange}
          />
        </div>
        <SettingsNav label="About" groups={[[section('about')]]} value={place.section} onChange={onChange} />
      </div>
    )
  },
  page: (ctx, place, go): Page | null => {
    if (place.section === 'this-mac') return { title: 'This Mac', body: <MacList ctx={ctx} pauseAll={false} lend={false} /> }
    if (place.section !== 'workers') return null
    return {
      title: words.workers,
      body: <WorkersList ctx={ctx} opened={place.worker} onOpen={(worker) => go({ section: 'workers', worker })} pauseAll />,
    }
  },
}

export const TAKES: readonly Take[] = [A, B, C]
