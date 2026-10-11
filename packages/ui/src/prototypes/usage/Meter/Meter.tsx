import { useControlled } from '../../../lib/controlled'
import { cx } from '../../../lib/cx'
import { HoverCard } from '../../../primitives/HoverCard/HoverCard'
import { UsageFigures, usageText, type UsageText } from '../UsageDetail/UsageDetail'
import { useOverlayScheme } from '../scheme'
import { percent, steps, strainOf, type Usage } from '../usage'
import s from './Meter.module.css'

/*
 * Direction A. CPU and memory as two short meters in the window's bar, in
 * five steps each: a step lights only when the load moves by a fifth, so
 * the bar holds still through the small changes a live number would twitch
 * at. The agents' part of each lights in cobalt. The numbers are behind it,
 * on hover or focus; a click swaps the meters for figures, and back.
 */

export interface MeterText extends UsageText {
  /** The meters' own short names. */
  cpuShort: string
  memoryShort: string
  /** The readout's name, with its numbers. */
  label: (cpu: number, memory: number) => string
}

export const meterText: MeterText = {
  ...usageText,
  cpuShort: 'CPU',
  memoryShort: 'MEM',
  label: (cpu, memory) => `CPU ${cpu}%, MEM ${memory}%`,
}

/** How many steps a meter has. */
export const STEPS = 5

export interface MeterGlyphProps {
  usage: Usage
  /** Figures in place of the steps. */
  figures?: boolean
  text?: Partial<MeterText>
}

/** The two meters, drawn: not a control. Direction A's readout wraps them; another readout can open its own detail from them. */
export function MeterGlyph({ usage, figures = false, text }: MeterGlyphProps) {
  const t = { ...meterText, ...text }
  return (
    <span className={cx(s.glyph, strainOf(usage) !== null && s.strained)}>
      <Gauge name={t.cpuShort} share={usage.cpu} ours={usage.althar} figure={figures ? t.percent(percent(usage.cpu)) : undefined} />
      <Gauge
        name={t.memoryShort}
        share={usage.memory}
        ours={usage.altharMemory}
        figure={figures ? t.percent(percent(usage.memory)) : undefined}
      />
    </span>
  )
}

function Gauge({ name, share, ours, figure }: { name: string; share: number; ours: number; figure: string | undefined }) {
  const lit = steps(share, STEPS)
  const mine = Math.min(lit, steps(ours, STEPS))
  return (
    <span className={s.gauge}>
      <span className={s.name}>{name}</span>
      {figure === undefined ? (
        <span className={s.steps} aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} data-lit={i < mine ? 'ours' : i < lit ? 'rest' : undefined} />
          ))}
        </span>
      ) : (
        <span className={s.figure}>{figure}</span>
      )}
    </span>
  )
}

export interface MeterProps {
  usage: Usage
  /** Figures in place of the meters, when the consumer holds it. A click swaps them. */
  figures?: boolean
  defaultFigures?: boolean
  onFiguresChange?: (figures: boolean) => void
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<MeterText>
}

export function Meter({ usage, figures, defaultFigures = false, onFiguresChange, open, defaultOpen, onOpenChange, text }: MeterProps) {
  const t = { ...meterText, ...text }
  const [shown, setShown] = useControlled(figures, defaultFigures, onFiguresChange)
  const strain = strainOf(usage)
  const scheme = useOverlayScheme()
  return (
    <span className={s.meter}>
      <HoverCard
        placement="below"
        align="end"
        width={248}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={scheme}
        card={<UsageFigures usage={usage} text={t} />}
      >
        <button
          type="button"
          className={s.button}
          aria-label={t.label(percent(usage.cpu), percent(usage.memory))}
          onClick={() => setShown(!shown)}
        >
          <MeterGlyph usage={usage} figures={shown} text={t} />
        </button>
      </HoverCard>
      <output className={s.strain}>{strain !== null && t.strain[strain]}</output>
    </span>
  )
}
