import { TaskCard, TaskLaunch, TaskStatus, type LaunchPick, type LaunchStep, type ModelInfo } from '@althar/ui'
import { useState } from 'react'

import { Agent, agentName } from '../content/agents'
import { COORDINATOR } from '../content/home'
import { AgentMark } from '../shared/AgentMark'
import s from './Coordinator.module.css'

/*
 * The coordinator, as the app shows it. You ask for two things; it answers
 * with what applies to the project and the plan for the first task,
 * in the product's own TaskLaunch card: who does each step, and a countdown.
 * Leaving it alone is a yes, so it starts on its own once you've seen it, and
 * becomes the running task's card.
 */

/** The agents as the product's cards take them: one model each, named for the agent. */
const model = (agent: Agent): ModelInfo => ({
  id: agent,
  name: agentName(agent),
  short: agentName(agent),
  runtime: agent,
  context: 1000,
  efforts: [],
})

const PLAN: readonly LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [model(Agent.Claude)], why: 'recommended for money code', fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [model(Agent.Codex), model(Agent.OpenCode)], why: 'two models, combined', optional: true },
  {
    id: 'sec',
    label: 'Security review',
    agents: [model(Agent.Codex)],
    why: 'required by your rule for money handling',
    fixed: 'your rule',
  },
  { id: 'verify', label: 'Verify', agents: [model(Agent.OpenCode)], why: 'the full suite', optional: true },
]

const TITLE = 'Rate-limit refunds like charges'
const isAgent = (id: string): id is Agent => Object.values<string>(Agent).includes(id)

/** Who runs a step, on this page: the agent, not a picker. In the app this is the composer's model picker. */
function Who({ agent }: LaunchPick) {
  return (
    <span className={s.pill}>
      {isAgent(agent.runtime) && <AgentMark agent={agent.runtime} size={13} />}
      {agent.name}
    </span>
  )
}

export function Coordinator() {
  const [started, setStarted] = useState<readonly string[] | null>(null)
  return (
    <div className={s.chat}>
      <p className={s.you}>{COORDINATOR.ask}</p>
      <div className={s.said}>
        <p className={s.me}>
          <i className={s.sq} aria-hidden="true" />
          Coordinator <span>just now</span>
        </p>
        <p>{COORDINATOR.reply}</p>
      </div>
      <div className="ch-root">
        {started ? (
          <TaskCard
            fresh
            task="431"
            title={TITLE}
            status={TaskStatus.Running}
            steps={started}
            at={0}
            now="Implement · reading the code it touches"
            started="started just now"
            lead={model(Agent.Claude)}
          />
        ) : (
          <TaskLaunch
            task="431"
            title={TITLE}
            project="billing-api"
            estimate="About 40 min · about $2 on your plans"
            defaultSteps={PLAN}
            picker={(pick) => <Who {...pick} />}
            wait={20}
            onStart={(steps) => setStarted([...steps.filter((st) => !st.skipped).map((st) => st.label), 'Draft PR'])}
          />
        )}
      </div>
      <p className={s.next}>
        <span className={s.n}>433</span>
        <b>Update the refunds docs</b>
        <span className={s.pill}>
          <AgentMark agent={Agent.OpenCode} size={13} />
          {agentName(Agent.OpenCode)}
        </span>
        <span className={s.then}>then</span>
        <span className={s.pill}>
          <AgentMark agent={Agent.Codex} size={13} />
          {agentName(Agent.Codex)}
        </span>
        <span className={s.when}>{started ? 'Running' : 'Starts with 431'}</span>
      </p>
    </div>
  )
}
