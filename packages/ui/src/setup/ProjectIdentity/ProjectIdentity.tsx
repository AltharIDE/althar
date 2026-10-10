import { RadioGroup } from 'radix-ui'
import { type CSSProperties, useId, useState } from 'react'

import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Field, FieldError } from '../../primitives/Field/Field'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import s from './ProjectIdentity.module.css'

/*
 * A project's name and the ink its mark is drawn in, changed in place at the
 * top of its settings: the mark as it is drawn, the name in a field that
 * keeps what was typed on Enter or when focus leaves it (Escape puts it
 * back), and the inks as swatches, the project's own ringed. A swatch
 * another project has says whose it is, and can still be chosen. Each change
 * goes out at once; the consumer shows it, and says when one didn't hold.
 */

export interface ProjectIdentityText {
  name: string
  colour: string
  /** Enter pressed with the name cleared. */
  empty: string
  /** Each ink's name, for its swatch. */
  inks: Record<ProjectInk, string>
  /** A swatch another project has: Teal, Halyard's. */
  whose: (ink: string, project: string) => string
}

export const projectIdentityText: ProjectIdentityText = {
  name: 'Name',
  colour: 'Colour',
  empty: 'Give the project a name.',
  inks: {
    [ProjectInk.Clay]: 'Clay',
    [ProjectInk.Ochre]: 'Ochre',
    [ProjectInk.Olive]: 'Olive',
    [ProjectInk.Moss]: 'Moss',
    [ProjectInk.Teal]: 'Teal',
    [ProjectInk.Slate]: 'Slate',
    [ProjectInk.Rose]: 'Rose',
    [ProjectInk.Umber]: 'Umber',
  },
  whose: (ink, project) => `${ink}, ${project}’s`,
}

const INKS: readonly ProjectInk[] = Object.values(ProjectInk)

export type ProjectIdentityProps = RootProps<
  'div',
  {
    name: string
    /** What its mark is drawn from: what stays when it is renamed, such as its id. */
    seed: string
    ink: ProjectInk
    /** The other projects' names, by the ink each has. */
    taken?: Partial<Record<ProjectInk, string>>
    /** A new name, trimmed, and different from the one it has. */
    onRename: (name: string) => void
    onInk: (ink: ProjectInk) => void
    /** Why the last change didn't hold. */
    error?: string
    text?: Partial<ProjectIdentityText>
  }
>

export function ProjectIdentity({ name, seed, ink, taken = {}, onRename, onInk, error, className, text, ...rest }: ProjectIdentityProps) {
  const t = { ...projectIdentityText, ...text }
  const id = useId()
  // What is typed, until it is kept or put back; null while the field shows the name.
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /** Keeps what was typed: a new name goes out; one cleared stays to be fixed after Enter, and goes back when focus leaves. */
  const keep = (leaving: boolean) => {
    if (draft === null) return
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (leaving) {
        setDraft(null)
        setProblem(null)
      } else setProblem(t.empty)
      return
    }
    setDraft(null)
    setProblem(null)
    if (trimmed !== name) onRename(trimmed)
  }

  return (
    <div className={cx(s.identity, className)} {...rest}>
      <ProjectMark seed={seed} ink={ink} size={44} />
      <div className={s.words}>
        <label className={s.label} htmlFor={`${id}-name`}>
          {t.name}
        </label>
        <Field
          id={`${id}-name`}
          value={draft ?? name}
          invalid={problem !== null}
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          // Escape puts back what was typed before it closes anything; with nothing typed, it goes on out.
          {...(draft === null ? {} : { 'data-own-escape': '' })}
          className={s.name}
          onChange={(event) => {
            setDraft(event.target.value)
            setProblem(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              keep(false)
            } else if (event.key === 'Escape' && draft !== null) {
              setDraft(null)
              setProblem(null)
            }
          }}
          onBlur={() => keep(true)}
        />
        {problem !== null && <FieldError id={`${id}-problem`}>{problem}</FieldError>}
        <span className={s.label} id={`${id}-colour`}>
          {t.colour}
        </span>
        <RadioGroup.Root
          aria-labelledby={`${id}-colour`}
          value={ink}
          onValueChange={(value) => {
            const picked = INKS.find((one) => one === value)
            if (picked !== undefined && picked !== ink) onInk(picked)
          }}
          orientation="horizontal"
          loop
          className={s.swatches}
        >
          {INKS.map((one) => {
            const whose = taken[one]
            const label = whose === undefined ? t.inks[one] : t.whose(t.inks[one], whose)
            return (
              <Tooltip key={one} label={label}>
                <RadioGroup.Item
                  value={one}
                  aria-label={label}
                  className={s.swatch}
                  style={{ '--swatch': `var(--project-${one})` } as CSSProperties}
                />
              </Tooltip>
            )
          })}
        </RadioGroup.Root>
        {error !== undefined && error !== '' && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
