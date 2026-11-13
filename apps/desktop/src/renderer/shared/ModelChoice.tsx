import { useMemo, useState } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { type ModelInfo, ModelBrowser, modelBrowserText, ModelPick, type ModelPickText, modKey } from '@althar/ui'

import { useModels, useSetDefaultEffort, useSetModelBlocked } from '../data/models'
import { useModelRooms } from '../features/usage/usePlan'
import {
  catalogOf,
  type Choice,
  choiceOf,
  defaultEffortOf,
  defaultPins,
  effortId,
  effortName,
  infoOf,
  keyOf,
  offersEffort,
  togglePin,
  useModelPrefs,
  withoutModel,
} from './models'

/*
 * Who runs a conversation, as the kit's model picker: the person's pinned
 * models, every model of every agent one step away, and how hard it thinks.
 * A model of another agent is that agent taking over: where something runs,
 * the picker asks first while a turn is under
 * way. Each model says how much room its plan has where work on it would
 * start, in the project where given. What the consumer does with the choice
 * is its own.
 */

/** What picking another agent's model does to a conversation that runs. */
export interface Handover {
  /** While a turn runs, what handing over would do, to ask first; null when nothing runs. */
  readonly ask: ((to: string, from: string) => string) | null
}

export interface ModelChoiceProps {
  /** Whose pick it is: Lead, Coordinator, Review. */
  owner: string
  /** The agents it offers: installed, and signed in or not saying (see `canPick`). */
  agents: ReadonlyArray<AgentStatus>
  value: Choice
  onChange: (choice: Choice) => void
  /** Take the pick off what it was for, like a step's review. */
  onRemove?: () => void
  /** Open everyone on the work: the lead's pick of a plan that hasn't begun. */
  onTeam?: () => void
  /** A model it doesn't offer, by key: for a step handed on, the one that failed it. */
  without?: string | null
  /** The project the pick is for, whose rule for moving work through an agent's accounts says which account each model's room is of. */
  projectId?: string
  /** A conversation under way, which another agent's model hands over. */
  handover?: Handover
  variant?: 'quiet' | 'field'
  placement?: 'above' | 'below'
  text?: Partial<ModelPickText>
  /** Its menu opened or closed: a plan's row, whose whole is the picker, keeps it under the pointer while it's open. */
  onOpenChange?: (open: boolean) => void
}

export function ModelChoice({
  owner,
  agents,
  value,
  onChange,
  onRemove,
  onTeam,
  without = null,
  projectId,
  handover,
  variant,
  placement,
  text,
  onOpenChange,
}: ModelChoiceProps) {
  const known = useModels()
  const room = useModelRooms(projectId)
  const setDefault = useSetDefaultEffort()
  const prefs = useModelPrefs()
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [asking, setAsking] = useState<ModelInfo | null>(null)
  const catalog = useMemo(() => withoutModel(catalogOf(known ?? [], agents), without), [known, agents, without])
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
        {...(onTeam === undefined ? {} : { onTeam })}
        {...(confirm === undefined ? {} : { confirm })}
        room={room}
        asking={asking}
        onAskingChange={setAsking}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onOpenChange?.(next)
        }}
        count={catalog.models.length}
        owner={owner}
        {...(variant === undefined ? {} : { variant })}
        {...(placement === undefined ? {} : { placement })}
        {...(text === undefined ? {} : { text })}
      />
      {browsing && (
        <ModelsBrowser
          agents={agents}
          without={without}
          value={current.id}
          {...(projectId === undefined ? {} : { projectId })}
          onPick={(picked) => {
            setBrowsing(false)
            // A pick that asks first asks in the picker, opened again on it.
            if (confirm?.(picked) !== undefined) {
              setAsking(picked)
              setOpen(true)
            } else choose(picked.id)
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}

export interface ModelsBrowserProps {
  /** The agents whose models it lists: installed, and signed in or not saying (see `canPick`). */
  agents: ReadonlyArray<AgentStatus>
  /** A model it doesn't list, by key: for a step handed on, the one that failed it. */
  without?: string | null
  /** The model in use, by key; none where nothing is. */
  value: string
  projectId?: string
  onPick: (model: ModelInfo) => void
  onClose: () => void
}

/**
 * Every model of every agent, as the kit's model browser: pins, each
 * model's default effort, its room, and the ones switched off, to switch
 * them on again. What picking one does is the consumer's.
 */
export function ModelsBrowser({ agents, without = null, value, projectId, onPick, onClose }: ModelsBrowserProps) {
  const known = useModels()
  const room = useModelRooms(projectId)
  const setDefault = useSetDefaultEffort()
  const setBlocked = useSetModelBlocked()
  const prefs = useModelPrefs()
  const catalog = useMemo(() => withoutModel(catalogOf(known ?? [], agents), without), [known, agents, without])
  const every = useMemo(() => withoutModel(catalogOf(known ?? [], agents, { withBlocked: true }), without), [known, agents, without])
  const blocked = (known ?? []).flatMap((offered) => offered.blocked.map((model) => keyOf(offered.agentId, model)))
  const pins = prefs.pins ?? defaultPins(catalog)
  /** Makes an effort a model's default; an agent's own default, whose model isn't known, has none to keep. */
  const makeDefault = (key: string, name: string) => {
    const { agentId, model } = choiceOf(key)
    if (model !== null) void setDefault({ agentId, model, effort: effortId(catalog, key, name) })
  }
  return (
    <ModelBrowser
      models={every.models}
      runtimes={every.runtimes}
      blocked={blocked}
      onToggleBlocked={(key) => {
        const { agentId, model } = choiceOf(key)
        if (model !== null) void setBlocked({ agentId, model, blocked: !blocked.includes(key) })
      }}
      value={value}
      pins={pins}
      defaultEffort={(info) => defaultEffortOf(catalog, info)}
      room={room}
      onPick={(key) => {
        const picked = every.models.find((info) => info.id === key)
        if (picked !== undefined) onPick(picked)
      }}
      onClose={onClose}
      onTogglePin={(key) => togglePin(key, pins)}
      onSetDefaultEffort={makeDefault}
      text={{
        columns: { model: 'Model', runtime: 'Agent', room: 'Usage', context: 'Context', effort: 'Default effort' },
        // The pin's shortcut as this system writes it.
        keys: { ...modelBrowserText.keys, pin: modKey('P') },
      }}
    />
  )
}
