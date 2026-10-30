import { useState } from 'react'

import { device } from '../../foundations/device'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Popover } from '../../primitives/Popover/Popover'
import { heldSteps, type LoadGlance, percent, STEPS, strained } from './load'
import s from './LoadMeter.module.css'
import { LoadPeek, loadPeekText, type LoadPeekText } from './LoadPeek'

/*
 * How hard this computer works, in the window's bar: CPU and memory as two
 * short meters of five steps, Althar's work's part of each lit in cobalt,
 * the rest in ink. A step lights only once the load is well past it and
 * goes out only once it is well under, so the bar holds still through the
 * small changes a figure would twitch at. A full CPU draws its meter in full
 * ink. Memory macOS is short of draws that meter in full ink too, since the steps
 * can't say it: a Mac keeps memory full on purpose. A click opens the peek (`LoadPeek`), which closes as one of its
 * rows opens its work.
 */

export interface LoadMeterText extends LoadPeekText {
  /** The meters' own short names. */
  cpuShort: string
  memoryShort: string
  /** The meter's name, with its numbers. */
  label: (cpu: number, memory: number) => string
  /** The peek's name. */
  peek: string
}

export const loadMeterText: LoadMeterText = {
  ...loadPeekText,
  cpuShort: 'CPU',
  memoryShort: 'MEM',
  label: (cpu, memory) => `CPU ${cpu}%, MEM ${memory}%`,
  peek: `${device.This}’s load`,
}

/** How many of the steps a share lights, held still near the edge of a step from one render to the next. */
const useSteps = (share: number) => {
  const [held, setHeld] = useState(() => heldSteps(share, STEPS, null))
  const steps = heldSteps(share, STEPS, held)
  if (steps !== held) setHeld(steps)
  return steps
}

/** One meter: its short name and five steps, Althar's part lit in cobalt, the rest in ink; in full ink when `full`. The plan gauge draws with it too. */
export function Gauge({ name, lit, ours, full }: { name: string; lit: number; ours: number; full: boolean }) {
  return (
    <span className={cx(s.gauge, full && s.full)}>
      <span className={s.name}>{name}</span>
      <span className={s.steps} aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} data-lit={i < Math.min(ours, lit) ? 'ours' : i < lit ? 'rest' : undefined} />
        ))}
      </span>
    </span>
  )
}

export type LoadMeterProps = RootProps<
  'span',
  {
    load: LoadGlance
    /** Opens a piece of work from its row in the peek, by its id. Without it, the rows say, but aren't ways in. */
    onOpen?: (id: string) => void
    /** Takes the meter out of the bar, from the peek. Without it, the peek has no switch. */
    onHide?: () => void
    /** How many readings the peek's trace has room for. */
    slots?: number
    /** The peek's heading level. */
    headingLevel?: HeadingLevel
    /** Whether the peek is open, when the consumer holds it. */
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    text?: Partial<LoadMeterText>
  }
>

export function LoadMeter({
  load,
  onOpen,
  onHide,
  slots,
  headingLevel,
  open,
  defaultOpen,
  onOpenChange,
  text,
  className,
  ...rest
}: LoadMeterProps) {
  const t = { ...loadMeterText, ...text }
  const [shown, setShown] = useControlled(open, defaultOpen ?? false, onOpenChange)
  const cpu = useSteps(load.cpu)
  const work = useSteps(load.work ?? 0)
  const memory = useSteps(load.memory)
  const workMemory = useSteps(load.workMemory ?? 0)
  return (
    <span className={cx(s.meter, className)} {...rest}>
      <Popover
        label={t.peek}
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={shown}
        onOpenChange={setShown}
        trigger={
          <button type="button" className={s.button} aria-label={t.label(percent(load.cpu), percent(load.memory))}>
            <Gauge name={t.cpuShort} lit={cpu} ours={work} full={cpu === STEPS} />
            <Gauge name={t.memoryShort} lit={memory} ours={workMemory} full={strained(load.pressure)} />
          </button>
        }
      >
        <LoadPeek
          load={load}
          onOpen={
            onOpen === undefined
              ? undefined
              : (id) => {
                  setShown(false)
                  onOpen(id)
                }
          }
          onHide={onHide}
          slots={slots}
          headingLevel={headingLevel}
          text={t}
        />
      </Popover>
    </span>
  )
}
