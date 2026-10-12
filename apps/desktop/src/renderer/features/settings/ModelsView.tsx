import { useState } from 'react'

import { type AgentStatus, isAgentDefault, knownModelName } from '@althar/contracts'
import { ModelSwitches } from '@althar/ui'

import { useModels, useSetModelBlocked } from '../../data/models'

/*
 * An agent's models, each switched on or off (ADR-015): the coordinator
 * picks among the ones on by what the work needs, and no picker offers one
 * that is off. Named as people know them; the agent's own default isn't one
 * of its own. A switch shows at once, ahead of the runtime saying so.
 */
export function ModelsView({ agent }: { agent: AgentStatus }) {
  const known = useModels()
  const setBlocked = useSetModelBlocked()
  // What was just switched, ahead of the runtime saying so.
  const [switched, setSwitched] = useState<Readonly<Record<string, boolean>>>({})
  const offered = known?.find((agentModels) => agentModels.agentId === agent.id)
  // A switch the runtime now says too is its word from here on.
  const agreed = Object.keys(switched).filter((id) => (offered?.blocked.includes(id) ?? false) === !switched[id])
  if (agreed.length > 0) setSwitched((now) => Object.fromEntries(Object.entries(now).filter(([id]) => !agreed.includes(id))))
  const models = (offered?.models ?? []).filter((model) => !isAgentDefault(model))
  const off = models
    .filter((model) => (model.id in switched ? switched[model.id] === false : (offered?.blocked.includes(model.id) ?? false)))
    .map((model) => model.id)
  return (
    <ModelSwitches
      agent={agent.name}
      models={models.map((model) => ({ id: model.id, name: knownModelName(agent, model) }))}
      off={off}
      onChange={(model, on) => {
        setSwitched((now) => ({ ...now, [model]: on }))
        // Not switched, it shows as it was at once; switched, until the runtime is read again and says so.
        void setBlocked({ agentId: agent.id, model, blocked: !on }).then((done) => {
          if (!done) setSwitched((now) => Object.fromEntries(Object.entries(now).filter(([id]) => id !== model)))
        })
      }}
    />
  )
}
