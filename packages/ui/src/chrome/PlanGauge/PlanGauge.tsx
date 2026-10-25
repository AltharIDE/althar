import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Popover } from '../../primitives/Popover/Popover'
import { STEPS } from '../LoadMeter/load'
import { Gauge } from '../LoadMeter/LoadMeter'
import meter from '../LoadMeter/LoadMeter.module.css'
import { type PlanAgent, type PlanSilent, SAY_UNDER, stepsUsed } from './plan'
import s from './PlanGauge.module.css'
import { PlanPeek, planPeekText, type PlanPeekText } from './PlanPeek'

/*
 * How much of the plans is left, in the window's bar, after CPU and memory
 * and in their exact manner: five steps, lit as the agent with least room
 * uses its tightest window, in full ink once under a tenth is left. Then the
 * bar says who and until when beside it ("Codex 3% · 14:00"), as the load
 * meter says memory running short. A click, or the consumer's shortcut,
 * opens the peek (`PlanPeek`).
 */

export interface PlanGaugeText extends PlanPeekText {
  short: string
  /** The gauge's name, with the figure that counts. */
  label: (agent: string, percent: number, until: string | null) => string
  /** Said beside the gauge once nearly out: Codex 3%. */
  said: (agent: string, share: string) => string
}

export const planGaugeText: PlanGaugeText = {
  ...planPeekText,
  short: 'PLAN',
  label: (agent, n, until) => `Plan usage: ${agent} has ${n}% left${until === null ? '' : `, until ${until}`}`,
  said: (agent, share) => `${agent} ${share}`,
}

export type PlanGaugeProps = RootProps<
  'span',
  {
    /** Least room first; the first is the figure that counts. */
    agents: readonly PlanAgent[]
    silent?: readonly PlanSilent[]
    headingLevel?: HeadingLevel
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    text?: Partial<PlanGaugeText>
  }
>

export function PlanGauge({ agents, silent, headingLevel, open, defaultOpen, onOpenChange, text, className, ...rest }: PlanGaugeProps) {
  const t = { ...planGaugeText, ...text }
  const [shown, setShown] = useControlled(open, defaultOpen ?? false, onOpenChange)
  const first = agents[0]
  const left = first?.left ?? 100
  const low = first !== undefined && left <= SAY_UNDER
  return (
    <span className={cx(s.plan, className)} {...rest}>
      <Popover
        label={t.heading}
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={shown}
        onOpenChange={setShown}
        trigger={
          <button
            type="button"
            className={meter.button}
            aria-label={first === undefined ? `${t.heading}: ${t.level.nothing}` : t.label(first.name, first.left, first.until)}
          >
            <Gauge name={t.short} lit={stepsUsed(left, STEPS)} ours={0} full={low} />
          </button>
        }
      >
        <PlanPeek agents={agents} silent={silent} headingLevel={headingLevel} text={t} />
      </Popover>
      {/* An output is a live status: an agent nearly out is read out as it is said. */}
      <output className={s.said}>
        {low && (
          <>
            {t.said(first.name, first.left === 0 ? t.shareOut : t.share(first.left))}
            {first.until !== null && <span className={s.until}> · {first.until}</span>}
          </>
        )}
      </output>
    </span>
  )
}
