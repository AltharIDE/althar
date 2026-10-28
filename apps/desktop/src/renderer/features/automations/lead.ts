import type { AgentStatus, AutomationStep, ThreadItem } from '@althar/contracts'

/*
 * Who leads a new automation's runs, to begin with: the person's usual lead,
 * the one their latest planned task's work went to, while its agent can
 * work; else the first agent that can, on its own model. They change it on
 * the card, as on a plan's.
 */

/** The lead the person's latest task in the coordinator's thread was planned with, where its agent can work; else the first agent's own. */
export const usualLead = (items: ReadonlyArray<ThreadItem>, agents: ReadonlyArray<AgentStatus>): AutomationStep => {
  const can = new Set(agents.map((agent) => agent.id))
  for (const item of items.toReversed()) {
    if (item.kind !== 'task') continue
    const step = item.content.plan?.steps.find((one) => one.key === 'implement')
    if (step !== undefined && can.has(step.agentId)) return { agentId: step.agentId, model: step.model, effort: step.effort ?? null }
  }
  return { agentId: agents[0]?.id ?? 'claude-code', model: null, effort: null }
}
