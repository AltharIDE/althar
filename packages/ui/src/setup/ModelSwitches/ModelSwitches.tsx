import { useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Field } from '../../primitives/Field/Field'
import s from './ModelSwitches.module.css'

/*
 * The models an agent offers, each switched on or off (ADR-015): one
 * switched off is never planned, and no picker offers it. The coordinator
 * picks among the rest by what the work needs, so this is the person's say
 * in what may be used: a long list from an agent like OpenCode is found in
 * by name.
 */

export interface SwitchedModel {
  id: string
  /** As people know it: Claude Sonnet 5.5. */
  name: string
}

export interface ModelSwitchesText {
  title: string
  count: (on: number, all: number) => string
  list: (agent: string) => string
  search: string
  none: string
  empty: string
}

export const modelSwitchesText: ModelSwitchesText = {
  title: 'Models',
  count: (on, all) => (on === all ? `all ${all} used` : `${on} of ${all} used`),
  list: (agent) => `${agent} models`,
  search: 'Find a model',
  none: 'No model matches',
  empty: 'It hasn’t said what it offers yet.',
}

/** A list this long is found in by name. */
const LONG = 8

export type ModelSwitchesProps = RootProps<
  'div',
  {
    /** The agent's name, for what the controls say. */
    agent: string
    models: readonly SwitchedModel[]
    /** The ones switched off, by id. */
    off: readonly string[]
    /** Switches a model off, or on again. */
    onChange: (id: string, on: boolean) => void
    text?: Partial<ModelSwitchesText>
  }
>

/** An agent's models, each switched on or off, found by name where there are many. */
export function ModelSwitches({ agent, models, off, onChange, className, text, ...rest }: ModelSwitchesProps) {
  const t = { ...modelSwitchesText, ...text }
  const [query, setQuery] = useState('')
  // Only while the field to find in shows: a list grown short again shows whole.
  const wanted = models.length > LONG ? query.trim().toLowerCase() : ''
  const shown = models.filter((model) => model.name.toLowerCase().includes(wanted))
  const on = shown.filter((model) => !off.includes(model.id)).map((model) => model.id)
  const used = models.filter((model) => !off.includes(model.id)).length
  return (
    <div className={cx(s.switches, className)} {...rest}>
      <div className={s.top}>
        <span className={s.title}>{t.title}</span>
        {models.length > 0 && <span className={s.count}>{t.count(used, models.length)}</span>}
      </div>
      {models.length === 0 && <p className={s.quiet}>{t.empty}</p>}
      {models.length > LONG && (
        <Field
          type="search"
          aria-label={t.search}
          placeholder={t.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={s.find}
        />
      )}
      {models.length > 0 && shown.length === 0 && <p className={s.quiet}>{t.none}</p>}
      {shown.length > 0 && (
        <CheckList
          label={t.list(agent)}
          items={shown.map((model) => ({ id: model.id, label: model.name }))}
          value={on}
          onChange={(next) => {
            // One changes at a time: the one that was on and isn't, or the other way round.
            const turned = shown.find((model) => on.includes(model.id) !== next.includes(model.id))
            if (turned !== undefined) onChange(turned.id, next.includes(turned.id))
          }}
          className={s.list}
        />
      )}
    </div>
  )
}
