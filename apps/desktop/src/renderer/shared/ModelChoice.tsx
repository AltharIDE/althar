import { useMemo, useState } from 'react'

import type { AgentStatus } from '@charrette/contracts'
import { type ModelInfo, ModelBrowser, ModelPick, type ModelPickText } from '@charrette/ui'

import { useModels } from '../data/models'
import {
  catalogOf,
  type Choice,
  choiceOf,
  defaultPins,
  effortId,
  effortName,
  infoOf,
  setDefaultEffort,
  togglePin,
  useModelPrefs,
} from './models'

/*
 * Who runs a conversation, as the kit's model picker: the person's pinned
 * models, every model of every agent one step away, and how hard it thinks.
 * A model of another agent is that agent taking over; what the consumer does
 * with the choice is its own.
 */

export interface ModelChoiceProps {
  /** Whose pick it is: Lead, Coordinator, Review. */
  owner: string
  /** The agents it offers: signed in, or that don't say. */
  agents: ReadonlyArray<AgentStatus>
  value: Choice
  onChange: (choice: Choice) => void
  /** Take the pick off what it was for, like a step's review. */
  onRemove?: () => void
  variant?: 'quiet' | 'field'
  placement?: 'above' | 'below'
  text?: Partial<ModelPickText>
}

export function ModelChoice({ owner, agents, value, onChange, onRemove, variant, placement, text }: ModelChoiceProps) {
  const known = useModels()
  const prefs = useModelPrefs()
  const [browsing, setBrowsing] = useState(false)
  const catalog = useMemo(() => catalogOf(known ?? [], agents), [known, agents])
  const current = infoOf(catalog, value)
  const pins = prefs.pins ?? defaultPins(catalog)
  const pinned = pins.flatMap((key) => catalog.models.filter((info) => info.id === key))
  /** A model's default effort: the person's, or what its agent is on. */
  const defaultOf = (info: ModelInfo) =>
    effortName(catalog, info.runtime, prefs.efforts[info.id] ?? catalog.agents.get(info.runtime)?.effort ?? null)

  const choose = (key: string) => {
    const { agentId, model } = choiceOf(key)
    // The person's default for this model, or the effort in use where the same agent keeps it.
    const effort = prefs.efforts[key] ?? (agentId === value.agentId ? value.effort : null)
    onChange({ agentId, model, effort })
  }

  return (
    <>
      <ModelPick
        model={current}
        pinned={pinned}
        // Without one of its own, the effort the agent is on.
        effort={effortName(catalog, value.agentId, value.effort ?? catalog.agents.get(value.agentId)?.effort ?? null)}
        defaultEffort={defaultOf(current)}
        onChange={choose}
        onEffort={(name) => onChange({ ...value, effort: effortId(catalog, value.agentId, name) })}
        onMakeDefault={(name) => setDefaultEffort(current.id, effortId(catalog, value.agentId, name))}
        onBrowse={() => setBrowsing(true)}
        {...(onRemove === undefined ? {} : { onRemove })}
        count={catalog.models.length}
        owner={owner}
        {...(variant === undefined ? {} : { variant })}
        {...(placement === undefined ? {} : { placement })}
        {...(text === undefined ? {} : { text })}
      />
      {browsing && (
        <ModelBrowser
          models={catalog.models}
          runtimes={catalog.runtimes}
          value={current.id}
          pins={pins}
          defaultEffort={defaultOf}
          onPick={(key) => {
            setBrowsing(false)
            choose(key)
          }}
          onClose={() => setBrowsing(false)}
          onTogglePin={(key) => togglePin(key, pins)}
          onSetDefaultEffort={(key, name) => setDefaultEffort(key, effortId(catalog, choiceOf(key).agentId, name))}
          text={{ columns: { model: 'Model', runtime: 'Agent', context: 'Context', effort: 'Default effort' } }}
        />
      )}
    </>
  )
}
