import { RadioGroup } from 'radix-ui'

import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Tooltip } from '../HoverCard/HoverCard'
import s from './InkSwatches.module.css'

/*
 * The inks a project's mark can be drawn in, as a row of swatches, one of
 * them ringed: the colour a project is known by. An ink another project has
 * says whose when pointed at, and can still be chosen. A radio group, from
 * Radix: one stop in the tab order, arrows move and choose.
 */

export interface InkSwatchesText {
  label: string
  /** Each ink's name. */
  inks: Record<ProjectInk, string>
  /** An ink another project has, by its name. */
  whose: (ink: string, project: string) => string
}

export const inkSwatchesText: InkSwatchesText = {
  label: 'Colour',
  inks: {
    [ProjectInk.Clay]: 'Clay',
    [ProjectInk.Ochre]: 'Ochre',
    [ProjectInk.Sand]: 'Sand',
    [ProjectInk.Olive]: 'Olive',
    [ProjectInk.Moss]: 'Moss',
    [ProjectInk.Teal]: 'Teal',
    [ProjectInk.Slate]: 'Slate',
    [ProjectInk.Indigo]: 'Indigo',
    [ProjectInk.Plum]: 'Plum',
    [ProjectInk.Rose]: 'Rose',
    [ProjectInk.Brick]: 'Brick',
    [ProjectInk.Umber]: 'Umber',
  },
  whose: (ink, project) => `${ink}, ${project}’s`,
}

/** Every ink, in the order the swatches show them. */
const ALL: readonly ProjectInk[] = Object.values(ProjectInk)

export interface InkSwatchesProps {
  value: ProjectInk
  onChange: (ink: ProjectInk) => void
  /** The inks offered, in order; every one unless given. */
  inks?: readonly ProjectInk[]
  /** Which other project has each ink, by its name. */
  taken?: Partial<Record<ProjectInk, string>>
  id?: string
  className?: string
  text?: Partial<InkSwatchesText>
}

/** The project inks as swatches, the chosen one ringed. */
export function InkSwatches({ value, onChange, inks = ALL, taken = {}, id, className, text }: InkSwatchesProps) {
  const t = { ...inkSwatchesText, ...text }
  return (
    <RadioGroup.Root
      id={id}
      aria-label={t.label}
      value={value}
      onValueChange={(next) => {
        const picked = inks.find((ink) => ink === next)
        if (picked !== undefined) onChange(picked)
      }}
      orientation="horizontal"
      loop
      className={cx(s.swatches, className)}
    >
      {inks.map((ink) => {
        const whose = taken[ink]
        const name = whose === undefined ? t.inks[ink] : t.whose(t.inks[ink], whose)
        return (
          <Tooltip key={ink} label={name}>
            <RadioGroup.Item value={ink} aria-label={name} className={s.swatch} style={cssVars({ '--swatch': `var(--project-${ink})` })} />
          </Tooltip>
        )
      })}
    </RadioGroup.Root>
  )
}
