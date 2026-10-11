import type { ReactNode } from 'react'

import { unreachable } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { below, Heading, type HeadingLevel } from '../../../primitives/Heading/Heading'
import { Popover } from '../../../primitives/Popover/Popover'
import { SettingSwitch } from '../../../setup/Preferences/Preferences'
import { UsageFigures, UsageShares, UsageTrace, usageText, type UsageText } from '../UsageDetail/UsageDetail'
import { arc } from '../arc'
import { useOverlayScheme } from '../scheme'
import { Load, loadOf, strainOf, type Usage } from '../usage'
import s from './Peek.module.css'

/*
 * Direction D. One small gauge in the bar, in three steps (quiet, busy,
 * full), which changes a few times an hour rather than a few times a
 * minute: a speedometer, not three rising bars, which read as signal
 * strength. Everything else is a click away, in a peek: the last two
 * minutes, the machine's figures, each running task's share across every
 * project, and a switch that takes the gauge out of the bar from there.
 */

export interface PeekText extends UsageText {
  /** The glyph's name, with how loaded the Mac is. */
  label: (load: string) => string
  /** The peek's name. */
  peek: string
  show: string
  showNote: string
}

export const peekText: PeekText = {
  ...usageText,
  label: (load) => `This Mac: ${load}`,
  peek: 'This Mac’s load',
  show: 'Show in the bar',
  showNote: 'Settings brings it back.',
}

/* a speedometer's 240 degrees, lit from the left up to its needle */
const HUB = { x: 8, y: 9.5 }
const R = 6
const SWEEP = { from: -120, to: 120 }

/** Where the needle points, in degrees from the top. */
function angleOf(load: Load) {
  switch (load) {
    case Load.Quiet:
      return -70
    case Load.Busy:
      return 0
    case Load.Full:
      return 70
    default:
      return unreachable(load)
  }
}

/** A gauge, its needle at how loaded the Mac is. Under strain it goes to full ink. */
export function LoadGlyph({ load, strained = false }: { load: Load; strained?: boolean }) {
  const angle = angleOf(load)
  const a = ((angle - 90) * Math.PI) / 180
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={cx(s.glyph, strained && s.strained)} aria-hidden="true">
      <path d={arc(HUB.x, HUB.y, R, SWEEP.from, SWEEP.to)} className={s.track} />
      <path d={arc(HUB.x, HUB.y, R, SWEEP.from, angle)} className={s.lit} />
      <line
        x1={HUB.x}
        y1={HUB.y}
        x2={(HUB.x + Math.cos(a) * 4.2).toFixed(2)}
        y2={(HUB.y + Math.sin(a) * 4.2).toFixed(2)}
        className={s.needle}
      />
      <circle cx={HUB.x} cy={HUB.y} r="1.3" className={s.hub} />
    </svg>
  )
}

export interface UsagePeekProps {
  usage: Usage
  /** Open a task from its row. Without it, the rows say, but aren't ways in. */
  onOpenTask?: (id: string) => void
  /** Take the readout out of the bar. Without it, the peek has no switch. */
  onHide?: () => void
  headingLevel?: HeadingLevel
  text?: Partial<PeekText>
}

/** What the peek holds: the trace, the figures, each task's share, and the switch. */
export function UsagePeek({ usage, onOpenTask, onHide, headingLevel = 2, text }: UsagePeekProps) {
  const t = { ...peekText, ...text }
  return (
    <div className={s.peek}>
      <span className={s.head}>
        <Heading level={headingLevel} className={s.title}>
          {t.machine}
        </Heading>
        <span className={s.load}>{t.load[loadOf(usage)]}</span>
      </span>
      <UsageTrace usage={usage} width={274} text={t} />
      <UsageFigures usage={usage} text={t} />
      <UsageShares
        shares={usage.shares}
        other={Math.max(0, usage.cpu - usage.althar)}
        onOpen={onOpenTask}
        headingLevel={below(headingLevel)}
        text={t}
      />
      {onHide !== undefined && (
        <div className={s.foot}>
          <SettingSwitch title={t.show} note={t.showNote} checked onChange={(on) => !on && onHide()} />
        </div>
      )}
    </div>
  )
}

export interface PeekReadoutProps extends UsagePeekProps {
  /** What sits in the bar. By default the three-step glyph; any drawing that isn't a control. */
  glyph?: ReactNode
  /** Whether the peek is open, when the consumer holds it. */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function PeekReadout({ usage, glyph, onOpenTask, onHide, headingLevel, open, defaultOpen, onOpenChange, text }: PeekReadoutProps) {
  const t = { ...peekText, ...text }
  const strain = strainOf(usage)
  const load = loadOf(usage)
  const scheme = useOverlayScheme()
  return (
    <span className={s.readout}>
      <Popover
        label={t.peek}
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={scheme}
        trigger={
          <button type="button" className={s.button} aria-label={t.label(t.load[load])}>
            {glyph ?? <LoadGlyph load={load} strained={strain !== null} />}
          </button>
        }
      >
        <UsagePeek usage={usage} onOpenTask={onOpenTask} onHide={onHide} headingLevel={headingLevel} text={text} />
      </Popover>
      <output className={s.strain}>{strain !== null && t.strain[strain]}</output>
    </span>
  )
}
