import { type AgentStatus, isAgentDefault, knownModelName } from '@althar/contracts'
import { ModelSwitches } from '@althar/ui'

import { useModels, useSetModelBlocked } from '../../data/models'

/*
 * An agent's models, each switched on or off (ADR-015): the coordinator
 * picks among the ones on by what the work needs, and no picker offers one
 * that is off. Named as people know them; the agent's own default isn't one
 * of its own. A switch shows at once, in every picker, ahead of the runtime
 * saying so (data/models.ts), and goes back if it doesn't go through.
 */
export function ModelsView({ agent }: { agent: AgentStatus }) {
  const known = useModels()
  const setBlocked = useSetModelBlocked()
  const offered = known?.find((agentModels) => agentModels.agentId === agent.id)
  const models = (offered?.models ?? []).filter((model) => !isAgentDefault(model))
  const off = models.filter((model) => offered?.blocked.includes(model.id) ?? false).map((model) => model.id)
  return (
    <ModelSwitches
      agent={agent.name}
      models={models.map((model) => ({ id: model.id, name: knownModelName(agent, model) }))}
      off={off}
      onChange={(model, on) => setBlocked({ agentId: agent.id, model, blocked: !on })}
    />
  )
}
