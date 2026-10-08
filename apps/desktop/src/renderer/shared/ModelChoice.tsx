import { useMemo, useState } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { type ModelInfo, ModelBrowser, ModelPick, type ModelPickText } from '@althar/ui'

import { useModels, useSetDefaultEffort } from '../data/models'
import {
  catalogOf,
  type Choice,
  choiceOf,
  defaultEffortOf,
  defaultPins,
  effortId,
  effortName,
  infoOf,
  offersEffort,
  togglePin,
  useModelPrefs,
} from './models'

/*
 * Who runs a conversation, as the kit's model picker: the person's pinned
 * models, every model of every agent one step away, and how hard it thinks.
 * A model of another agent is that agent taking over: where something runs,
 * the picker says so on those models, and asks first while a turn is under
 * way. What the consumer does with the choice is its own.
 */

/** What picking another agent's model does to a conversation that runs. */
export interface Handover {
  /** A word on another agent's model: that picking it hands the conversation over. */
  readonly note: (agent: string) => string
  /** While a turn runs, what handing over would do, to ask first; null when nothing runs. */
  readonly ask: ((to: string, from: string) => string) | null
}

export interface ModelChoiceProps {
  /** Whose pick it is: Lead, Coordinator, Review. */
  owner: string
  /** The agents it offers: signed in, or that don't say. */
  agents: ReadonlyArray<AgentStatus>
  value: Choice
  onChange: (choice: Choice) => void
  /** Take the pick off what it was for, like a step's review. */
  onRemove?: () => void
  /** A conversation under way, which another agent's model hands over. */
  handover?: Handover
  variant?: 'quiet' | 'field'
  placement?: 'above' | 'below'
  text?: Partial<ModelPickText>
}

export function ModelChoice({ owner, agents, value, onChange, onRemove, handover, variant, placement, text }: ModelChoiceProps) {
  const known = useModels()
  const setDefault = useSetDefaultEffort()
  const prefs = useModelPrefs()
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [asking, setAsking] = useState<ModelInfo | null>(null)
  const catalog = useMemo(() => catalogOf(known ?? [], agents), [known, agents])
  const current = infoOf(catalog, value)
  const pins = prefs.pins ?? defaultPins(catalog)
  const pinned = pins.flatMap((key) => catalog.models.filter((info) => info.id === key))
  const defaultOf = (info: ModelInfo) => defaultEffortOf(catalog, info)
  const agentName = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId
  const another = (info: ModelInfo) => info.runtime !== value.agentId
  const ask = handover?.ask ?? null
  const confirm =
    ask === null ? undefined : (info: ModelInfo) => (another(info) ? ask(agentName(info.runtime), agentName(value.agentId)) : undefined)

  const choose = (key: string) => {
    const { agentId, model } = choiceOf(key)
    // The person's default for this model, or the effort in use where the same agent keeps it and the model offers it.
    const kept = agentId === value.agentId && offersEffort(catalog, key, value.effort) ? value.effort : null
    onChange({ agentId, model, effort: catalog.defaults.get(key) ?? kept })
  }
  /** Makes an effort a model's default; an agent's own default, whose model isn't known, has none to keep. */
  const makeDefault = (key: string, name: string) => {
    const { agentId, model } = choiceOf(key)
    if (model !== null) void setDefault({ agentId, model, effort: effortId(catalog, key, name) })
  }

  return (
    <>
      <ModelPick
        model={current}
        pinned={pinned}
        // Without one of its own, the effort it starts at: the person's default, or else the model's own.
        effort={effortName(catalog, current.id, value.effort) ?? defaultOf(current)}
        defaultEffort={defaultOf(current)}
        onChange={choose}
        onEffort={(name) => onChange({ ...value, effort: effortId(catalog, current.id, name) })}
        {...(choiceOf(current.id).model === null ? {} : { onMakeDefault: (name: string) => makeDefault(current.id, name) })}
        onBrowse={() => setBrowsing(true)}
        {...(onRemove === undefined ? {} : { onRemove })}
        {...(handover === undefined
          ? {}
          : { note: (info: ModelInfo) => (another(info) ? handover.note(agentName(info.runtime)) : undefined) })}
        {...(confirm === undefined ? {} : { confirm })}
        asking={asking}
        onAskingChange={setAsking}
        open={open}
        onOpenChange={setOpen}
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
            const picked = catalog.models.find((info) => info.id === key)
            // A pick that asks first asks in the picker, opened again on it.
            if (picked !== undefined && confirm?.(picked) !== undefined) {
              setAsking(picked)
              setOpen(true)
            } else choose(key)
          }}
          onClose={() => setBrowsing(false)}
          onTogglePin={(key) => togglePin(key, pins)}
          onSetDefaultEffort={makeDefault}
          text={{ columns: { model: 'Model', runtime: 'Agent', context: 'Context', effort: 'Default effort' } }}
        />
      )}
    </>
  )
}
