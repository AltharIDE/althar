import { RadioGroup } from 'radix-ui'
import { useCallback, useLayoutEffect, useRef, useState, type ReactElement } from 'react'

import { cx } from '../../lib/cx'
import { useControlName } from '../FormRow/FormRow'
import { Tooltip } from '../HoverCard/HoverCard'
import { Kbd } from '../Kbd/Kbd'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Segmented.module.css'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
  /** Its shortcut, shown after the label; the consumer binds it. */
  kbd?: string
  /** A tooltip: more of the option's name, and a shortcut it doesn't show. */
  tooltip?: { label: string; kbd?: string }
  /** A dot after the label: something new there, or something there waits on you (violet). */
  dot?: 'new' | 'yours'
  /** What the dot means, for assistive technology. */
  dotLabel?: string
}

export interface SegmentedProps<V extends string> {
  /** What is being chosen. Leave it out inside a FormRow, which names it. */
  label?: string
  options: readonly SegmentedOption<V>[]
  /** The one on; null for none yet, where something else has the place the choice is about. */
  value: V | null
  onChange: (value: V) => void
  id?: string
  className?: string
}

/**
 * A few choices side by side, one of them on. A radio group, from Radix: one
 * stop in the tab order, arrows move and choose, Home and End go to either
 * end, disabled choices are passed over.
 */
export function Segmented<V extends string>({ label, options, value, onChange, id, className }: SegmentedProps<V>) {
  const name = useControlName(label)
  const { ref, spot, sliding, chose, landed } = useIndicator(value)
  return (
    <RadioGroup.Root
      ref={ref}
      id={id}
      {...name}
      value={value ?? ''}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) {
          chose()
          onChange(picked.value)
        }
      }}
      orientation="horizontal"
      loop
      className={cx(s.group, sliding && s.sliding, className)}
    >
      {spot && (
        <span
          className={s.indicator}
          aria-hidden="true"
          onTransitionEnd={landed}
          style={{ width: spot.width, transform: `translateX(${spot.left}px)` }}
        />
      )}
      {options.map((o) => (
        <Tip key={o.value} tip={o.tooltip}>
          <RadioGroup.Item value={o.value} disabled={o.disabled} className={s.option}>
            {o.label}
            {o.dot && <span className={cx(s.dot, s[o.dot])} aria-hidden="true" />}
            {o.dotLabel && <VisuallyHidden>, {o.dotLabel}</VisuallyHidden>}
            {o.kbd && <Kbd className={s.kbd}>{o.kbd}</Kbd>}
          </RadioGroup.Item>
        </Tip>
      ))}
    </RadioGroup.Root>
  )
}

/**
 * Where the chosen option is, for the one element that sits behind the
 * options. It slides only when the person chose (Radix calls onValueChange for
 * that alone) and motion is welcome; a first render, a value that arrives, and
 * a resize simply place it.
 */
function useIndicator(value: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const chosen = useRef(false)
  const [spot, setSpot] = useState<{ left: number; width: number } | null>(null)
  const [sliding, setSliding] = useState(false)

  const measure = useCallback(() => {
    const on = ref.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
    const next = on ? { left: on.offsetLeft, width: on.offsetWidth } : null
    setSpot((was) => (was?.left === next?.left && was?.width === next?.width ? was : next))
  }, [])

  useLayoutEffect(() => {
    const animate = chosen.current && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    chosen.current = false
    setSliding(animate)
  }, [value])

  /* every render: options reordered or replaced move the chosen one without resizing anything watched */
  useLayoutEffect(measure)

  useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    const watch = new ResizeObserver(measure)
    watch.observe(group)
    for (const o of group.querySelectorAll('[role="radio"]')) watch.observe(o)
    return () => watch.disconnect()
  })

  return { ref, spot, sliding, chose: () => (chosen.current = true), landed: () => setSliding(false) }
}

function Tip({ tip, children }: { tip?: { label: string; kbd?: string }; children: ReactElement }) {
  return tip ? (
    <Tooltip label={tip.label} kbd={tip.kbd}>
      {children}
    </Tooltip>
  ) : (
    children
  )
}
