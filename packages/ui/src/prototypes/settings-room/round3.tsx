// Scrappy, the third round: the quick panel on every screen, with cards for what is flipped often and a slimmer agents at once; All settings opens Settings as a tab.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { MOST_AT_ONCE } from '../../../../contracts/src/index'
import {
  type AtOnceMachine,
  AppVersion,
  Button,
  ControlCenter,
  ControlFoot,
  ControlGrid,
  ControlLine,
  ControlMarks,
  ControlModule,
  type ControlPlace,
  ControlSheet,
  ControlToggle,
  Icon,
  type IconName,
  IconButton,
  LinkButton,
  type MarkGlance,
  SettingRow,
} from '../../index'
import { cx } from '../../lib/cx'
import ps from '../../setup/Preferences/Preferences.module.css'
import { SectionNav, SectionPanel } from './frame'
import { type Models, useModels } from './models'
import r from './round3.module.css'
import type { ProtoSettingsProps } from './seams/SettingsPanel'
import { notifyAll, type SectionId } from './sections'
import type { Round3 } from './state'
import { settingsTab, useSettingsTab } from './tab'

import { SYSTEM_SOUND } from '../../../../../apps/desktop/src/main/notify'
import { notesOf } from '../../../../../apps/desktop/src/main/updates'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'
import type { StartModel } from '../../../../../apps/desktop/src/renderer/features/start/useStart'
import { brandOf } from '../../../../../apps/desktop/src/renderer/shared/agents'

/* ——— The directions: which cards the quick panel holds ——— */

type CardId = 'keepAwake' | 'notify' | 'sound' | 'load' | 'agents' | 'agentsWide'

export const ROUND3_CARDS: Readonly<
  Record<Round3, { readonly name: string; readonly what: string; readonly cards: ReadonlyArray<CardId>; readonly across?: boolean }>
> = {
  A3: {
    name: 'Sound',
    what: 'Four cards: Keep awake, Notifications, Sound (silence it for a meeting), and CPU and memory in the bar.',
    cards: ['keepAwake', 'notify', 'sound', 'load'],
  },
  B3: {
    name: 'Agents card',
    what: 'Four cards: Keep awake, Notifications, CPU and memory, and Agents, which says when one needs signing in again.',
    cards: ['keepAwake', 'notify', 'load', 'agents'],
  },
  C3: {
    name: 'Three across',
    what: 'Three cards in one row: Keep awake, Notifications and Sound.',
    cards: ['keepAwake', 'notify', 'sound'],
    across: true,
  },
  D3: {
    name: 'Agents across',
    what: 'Keep awake and Notifications, with the agents across under them: their marks, and the one that needs you.',
    cards: ['keepAwake', 'notify', 'agentsWide'],
  },
  E3: { name: 'Just two', what: 'Only Keep awake and Notifications, then agents at once.', cards: ['keepAwake', 'notify'] },
}

/* ——— The cards ——— */

interface Toggle {
  readonly title: string
  readonly line: string
  readonly on: boolean
  readonly set: (on: boolean) => void
  readonly glyph: IconName
  readonly section: SectionId
}

/** The sound last chosen, which Sound's card puts back when it is turned on again. */
let lastSound = 'Glass'

const toggleOf = (m: Models, id: 'keepAwake' | 'notify' | 'sound' | 'load', withSound: boolean): Toggle => {
  const { preferences, set } = m.preferences
  switch (id) {
    case 'keepAwake':
      return {
        title: text.awake,
        line: preferences.keepAwake ? text.awakeOn : text.off,
        on: preferences.keepAwake,
        set: (on) => set('keepAwake', on),
        glyph: 'cup',
        section: 'mac',
      }
    case 'notify': {
      const on = preferences.notifyCalls || preferences.notifyReady || preferences.notifyStopped
      // With a card of its own for the sound, this one says only when they come.
      const line = !on
        ? text.off
        : withSound
          ? 'When you’re away'
          : preferences.sound === null
            ? text.silent
            : preferences.sound === SYSTEM_SOUND
              ? text.withSound
              : preferences.sound
      return { title: text.notify, line, on, set: (next) => notifyAll(m, next), glyph: 'bell', section: 'notify' }
    }
    case 'sound':
      return {
        title: 'Sound',
        line: preferences.sound === null ? 'Silent' : preferences.sound === SYSTEM_SOUND ? text.withSound : preferences.sound,
        on: preferences.sound !== null,
        set: (on) => {
          if (!on && preferences.sound !== null) lastSound = preferences.sound
          set('sound', on ? lastSound : null)
        },
        glyph: 'sound',
        section: 'notify',
      }
    case 'load':
      return {
        title: 'CPU and memory',
        line: preferences.showLoad ? 'In the bar' : text.off,
        on: preferences.showLoad,
        set: (on) => set('showLoad', on),
        glyph: 'load',
        section: 'mac',
      }
  }
}

/** The agents in a line: the one that needs signing in again, else how many. */
const agentsLine = (m: Models): { readonly line: string; readonly tone?: 'yours' } => {
  const agents = m.start.status?.agents ?? []
  const out = agents.find((agent) => agent.accounts.some((account) => account.signIn === 'signed_out'))
  if (out !== undefined) return { line: `${out.name} signed out`, tone: 'yours' }
  return {
    line: text.counted(
      agents.length,
      agents.reduce((n, agent) => n + agent.accounts.length, 0),
    ),
  }
}

const agentMarks = (m: Models): ReadonlyArray<MarkGlance> =>
  (m.start.status?.agents ?? []).map((agent) => {
    const brand = brandOf(agent.id)
    return {
      id: agent.id,
      name: agent.name,
      ...(brand === undefined ? {} : { brand }),
      ...(agent.installed ? {} : { faint: true }),
      ...(agent.accounts.some((account) => account.signIn === 'signed_out') ? { yours: true } : {}),
    }
  })

/**
 * The direction's cards: two to a row in the panel (three across in C), or
 * one under another down the side of the Settings tab. A card's name opens
 * its section; its circle flips it.
 */
function Cards({
  m,
  cards,
  across = false,
  side = false,
  onOpen,
}: {
  m: Models
  cards: ReadonlyArray<CardId>
  across?: boolean
  side?: boolean
  onOpen: (id: SectionId) => void
}) {
  const withSound = cards.includes('sound')
  // Where each goes, in rows of 28px: a card is two rows, the agents across three.
  let row = 1
  let half = 0
  const placed = cards.map((id, i): { id: CardId; place: ControlPlace } => {
    const tall = id === 'agentsWide' ? 3 : 2
    if (side) {
      const place: ControlPlace = { column: [1, 3], row: [row, row + tall] }
      row += tall
      return { id, place }
    }
    if (across) return { id, place: { column: [1 + i * 2, 3 + i * 2], row: [1, 3] } }
    if (id === 'agentsWide') {
      if (half === 1) row += 2
      half = 0
      const place: ControlPlace = { column: [1, 5], row: [row, row + tall] }
      row += tall
      return { id, place }
    }
    const place: ControlPlace = { column: half === 0 ? [1, 3] : [3, 5], row: [row, row + 2] }
    if (half === 1) row += 2
    half = half === 0 ? 1 : 0
    return { id, place }
  })
  const agents = m.start.status?.agents ?? []
  const said = agentsLine(m)
  return (
    <ControlGrid row={28} columns={side ? 2 : across ? 6 : 4}>
      {placed.map(({ id, place }) => {
        if (id === 'agents' || id === 'agentsWide')
          return (
            <ControlModule
              key={id}
              title={text.agents}
              {...(id === 'agentsWide' ? { aside: text.accounts(agents.reduce((n, agent) => n + agent.accounts.length, 0)) } : {})}
              onClick={() => onOpen('agents')}
              place={place}
            >
              {id === 'agentsWide' && <ControlMarks marks={agentMarks(m)} />}
              <ControlLine tone={said.tone}>{said.line}</ControlLine>
            </ControlModule>
          )
        const one = toggleOf(m, id, withSound)
        return (
          <ControlToggle
            key={id}
            title={one.title}
            line={one.line}
            on={one.on}
            onChange={one.set}
            glyph={<Icon name={one.glyph} size={16} />}
            onOpen={() => onOpen(one.section)}
            place={place}
          />
        )
      })}
    </ControlGrid>
  )
}

/* ——— Agents at once, slimmer: one plain line, and a step for each number ——— */

/**
 * The kit's AgentsAtOnce (setup/Preferences), drawn by its own styles, with
 * three changes: the line under its name is one plain sentence, whatever the
 * number; a dot on the track for each number it can be; and no scale under
 * the track, the default only its violet mark.
 */
export function AtOnceCompact({
  count,
  own: kept,
  machine,
  most = MOST_AT_ONCE,
  onChange,
}: {
  count: number
  own: boolean
  machine: AtOnceMachine
  most?: number
  onChange: (count: number | null) => void
}) {
  const [held, setHeld] = useState<number | null>(null)
  const [clicks, setClicks] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const n = held ?? count
  const own = held === null ? kept : n !== machine.count
  const heat = Math.max(0, Math.min(1, (n - machine.count) / Math.max(1, most - machine.count)))
  const at = (v: number) => `${((v - 1) / Math.max(1, most - 1)) * 100}%`
  const clamp = (v: number) => Math.max(1, Math.min(most, v))
  const show = (next: number) => {
    if (next === machine.count && n !== machine.count) setClicks((c) => c + 1)
  }
  const send = (next: number) => {
    if (next !== count || (next === machine.count && kept)) onChange(next === machine.count ? null : next)
  }
  const from = (x: number) => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return n
    const raw = 1 + ((x - box.left) / box.width) * (most - 1)
    if (Math.abs(raw - machine.count) < 0.6) return machine.count
    return clamp(Math.round(raw))
  }
  const hold = (next: number) => {
    show(next)
    setHeld(next)
  }
  const heatStyle = { '--heat': heat } as CSSProperties
  return (
    <SettingRow
      className={r.compact}
      title="Agents at once"
      note={
        <>
          More tasks than this wait their turn.
          {own && held === null && (
            <>
              {' '}
              <LinkButton
                className={ps.reset}
                onClick={() => {
                  show(machine.count)
                  onChange(null)
                }}
              >
                Use this Mac’s {machine.count}
              </LinkButton>
            </>
          )}
        </>
      }
      glyph={
        <span className={ps.breathe} style={{ ...heatStyle, '--speed': `${2.8 - heat * 2.1}s` } as CSSProperties}>
          <Icon name="agents" size={15} />
        </span>
      }
      under={
        <div className={ps.slider} style={heatStyle}>
          <div
            ref={track}
            className={ps.track}
            role="slider"
            tabIndex={0}
            aria-label="Agents at once"
            aria-valuemin={1}
            aria-valuemax={most}
            aria-valuenow={n}
            aria-valuetext={n === machine.count ? `${n}, this Mac’s default` : String(n)}
            onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              hold(from(e.clientX))
            }}
            onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
              if (held !== null) hold(from(e.clientX))
            }}
            onPointerUp={() => {
              if (held === null) return
              setHeld(null)
              send(held)
            }}
            onPointerCancel={() => setHeld(null)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              const steps: Record<string, number> = {
                ArrowRight: n + 1,
                ArrowUp: n + 1,
                ArrowLeft: n - 1,
                ArrowDown: n - 1,
                Home: 1,
                End: most,
              }
              const next = steps[e.key]
              if (next === undefined) return
              e.preventDefault()
              show(clamp(next))
              send(clamp(next))
            }}
          >
            <div className={ps.rail}>
              <div className={ps.fill} style={{ width: at(n) }} />
            </div>
            <span className={r.ticks} aria-hidden="true">
              {Array.from({ length: most }, (_, i) => i + 1).map((v) => (
                <i key={v} className={cx(r.tick, v <= n && r.tickIn)} style={{ left: at(v) }} />
              ))}
            </span>
            <span className={ps.atDefault} style={{ left: at(machine.count) }} />
            <span
              key={clicks}
              className={cx(ps.thumb, held !== null && ps.held, !own && clicks > 0 && ps.clicked)}
              style={{ left: at(n) }}
            />
          </div>
        </div>
      }
    >
      {() => (
        <span className={ps.value} style={heatStyle} aria-hidden="true">
          {n}
        </span>
      )}
    </SettingRow>
  )
}

/* ——— The quick panel ——— */

export function Direction3({ start, open, onOpenChange, glance, variant }: ProtoSettingsProps & { variant: Round3 }) {
  const m = useModels(start, open, glance)
  const spec = ROUND3_CARDS[variant]
  const show = (section: SectionId) => {
    onOpenChange(false)
    settingsTab.show(section)
  }
  // ⌘⇧, opens the Settings tab, from anywhere.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.code !== 'Comma') return
      event.preventDefault()
      onOpenChange(false)
      settingsTab.show(settingsTab.get().section)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])
  const version = m.start.status?.appVersion
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      width={spec.across === true ? 600 : 440}
      text={{ label: text.title }}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Cards m={m} cards={spec.cards} across={spec.across} onOpen={show} />
        {m.atOnce !== null && (
          <ControlSheet>
            <AtOnceCompact
              count={m.atOnce.atOnce.count}
              own={m.atOnce.atOnce.own !== null}
              machine={m.atOnce.atOnce.machine}
              onChange={m.atOnce.set}
            />
          </ControlSheet>
        )}
      </div>
      <ControlFoot>
        {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
        <Button size="small" icon="gear" kbd="⌘⇧," onClick={() => show(settingsTab.get().section)}>
          All settings
        </Button>
      </ControlFoot>
    </ControlCenter>
  )
}

/* ——— Settings, as a tab ——— */

/** The Settings tab's page: the direction's cards down the side, over the sections; the section chosen beside them. */
export function SettingsTabPage({ variant, start }: { variant: Round3; start: StartModel }) {
  const tab = useSettingsTab()
  const m = useModels(start, true, undefined)
  const spec = ROUND3_CARDS[variant]
  const pick = (section: SectionId) => settingsTab.set({ section })
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--n-2)' }}>
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '24px 48px 72px',
          display: 'grid',
          gridTemplateColumns: '264px minmax(0, 1fr)',
          gap: 28,
          alignItems: 'start',
        }}
      >
        <aside style={{ position: 'sticky', top: 0, display: 'grid', gap: 16 }}>
          <Cards m={m} cards={spec.cards} side onOpen={pick} />
          <SectionNav current={tab.section} onPick={pick} />
        </aside>
        <main>
          <SectionPanel key={tab.section} id={tab.section} m={m} headingLevel={1} />
        </main>
      </div>
    </div>
  )
}
