import { cx } from '../../../lib/cx'
import { HoverCard } from '../../../primitives/HoverCard/HoverCard'
import { Sparkline, UsageFigures, UsageTrace, usageText, type UsageText } from '../UsageDetail/UsageDetail'
import { useOverlayScheme } from '../scheme'
import { percent, strainOf, type Usage } from '../usage'
import s from './Trace.module.css'

/*
 * Direction B. The last two minutes of CPU as a trace beside the work's
 * status, and the figure now. The only direction with history at rest: it
 * shows that a build started a minute ago, not only that the Mac is busy.
 * The agents' part is the cobalt under the line. It is also the one that
 * moves most, so it moves slowly: the consumer adds a point every few
 * seconds, and nothing slides between them.
 */

export interface TraceText extends UsageText {
  /** The readout's name, with its numbers. */
  label: (cpu: number, agents: number) => string
  /** The detail's title. */
  over: string
}

export const traceText: TraceText = {
  ...usageText,
  label: (cpu, agents) => `CPU ${cpu}%, agents ${agents}%`,
  over: 'CPU over the last 2 minutes',
}

export interface TraceProps {
  usage: Usage
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<TraceText>
}

export function Trace({ usage, open, defaultOpen, onOpenChange, text }: TraceProps) {
  const t = { ...traceText, ...text }
  const strain = strainOf(usage)
  const scheme = useOverlayScheme()
  return (
    <span className={cx(s.trace, strain !== null && s.strained)}>
      <HoverCard
        placement="below"
        align="end"
        width={264}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={scheme}
        card={
          <>
            <span className={s.over}>{t.over}</span>
            <UsageTrace usage={usage} width={238} text={t} />
            <UsageFigures usage={usage} text={t} />
          </>
        }
      >
        <button type="button" className={s.button} aria-label={t.label(percent(usage.cpu), percent(usage.althar))}>
          <span className={s.name}>{t.cpu}</span>
          <Sparkline points={usage.history} width={56} height={16} strained={strain !== null} />
          <span className={s.figure}>{t.percent(percent(usage.cpu))}</span>
        </button>
      </HoverCard>
      <output className={s.strain}>{strain !== null && t.strain[strain]}</output>
    </span>
  )
}
