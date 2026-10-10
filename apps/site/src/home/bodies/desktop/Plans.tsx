import { Icon } from '@althar/ui'
import { type CSSProperties, Fragment, useRef } from 'react'

import { Agent } from '../../../content/agents'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { useSeen } from '../kit/seen'
import s from './Plans.module.css'

/*
 * Your plans, closer than Settings draws them: the Agents panel opened out
 * with every agent side by side, each with how many of your plans it signs
 * in as, large, and the plans under it. The order is the order work goes
 * in: the first with room takes the next task, and one resting until its
 * reset says when it is back. Settings' own look (frost, the agents as
 * columns), touched up to make the one point. On a phone, only the point:
 * each agent, how many, and the plans' names.
 */

interface Plan {
  name: string
  /** As a phone lists it. */
  short: string
  who: string
  /** Resting until this time. */
  back?: string
}

const AGENTS: ReadonlyArray<{ id: Agent; name: string; maker: string; noun: string; plans: Plan[] }> = [
  {
    id: Agent.Claude,
    name: 'Claude Code',
    maker: 'Anthropic',
    noun: 'Claude plans',
    plans: [
      { name: 'Claude Max', short: 'Max', who: 'Personal · you@hey.com' },
      { name: 'Claude Team', short: 'Team', who: 'Northwind · dana@northwind.io', back: '14:00' },
    ],
  },
  {
    id: Agent.Codex,
    name: 'Codex',
    maker: 'OpenAI',
    noun: 'ChatGPT plans',
    plans: [
      { name: 'ChatGPT Pro', short: 'Pro', who: 'Personal · you@hey.com' },
      { name: 'ChatGPT Team', short: 'Team', who: 'Northwind · dana@northwind.io' },
      { name: 'ChatGPT Plus', short: 'Plus', who: 'Client · ~/.codex-client' },
    ],
  },
  {
    id: Agent.OpenCode,
    name: 'OpenCode',
    maker: 'Any provider',
    noun: 'keys and plans',
    plans: [
      { name: 'GLM Coding Plan', short: 'GLM Coding Plan', who: 'Z.ai' },
      { name: 'OpenRouter', short: 'OpenRouter', who: 'key ····9c1e · per use' },
    ],
  },
]

/** `play`, when given, says when it comes in, in place of being seen. */
export function Plans({ play }: { play?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const seenSelf = useSeen(ref, 0.3)
  const seen = play ?? seenSelf
  const total = AGENTS.reduce((n, a) => n + a.plans.length, 0)
  return (
    <div ref={ref} className={cx(s.panel, seen && s.seen)}>
      <div className={s.top}>
        <span className={s.back} aria-hidden="true">
          <Icon name="chevron" size={12} />
        </span>
        <b>Agents</b>
        <span className={s.count}>
          {AGENTS.length} agents · {total} accounts
        </span>
      </div>
      <div className={s.columns}>
        {AGENTS.map((agent, a) => (
          <section key={agent.id} className={s.column} style={{ '--a': a } as CSSProperties}>
            <header className={s.agent}>
              <span className={s.mark}>
                <AgentMark agent={agent.id} size={22} />
              </span>
              <span>
                <b>{agent.name}</b>
                <span>{agent.maker}</span>
              </span>
            </header>
            <p className={s.big}>
              <b>{agent.plans.length}</b>
              <span>{agent.noun}</span>
            </p>
            <ol className={s.plans}>
              {agent.plans.map((plan, i) => (
                <li key={plan.name} className={cx(plan.back && s.resting)} style={{ '--i': i } as CSSProperties}>
                  <span className={s.n}>{i + 1}</span>
                  <span className={s.planWords}>
                    <b>{plan.name}</b>
                    <span>{plan.who}</span>
                  </span>
                  {plan.back && <span className={s.state}>back at {plan.back}</span>}
                </li>
              ))}
            </ol>
            <p className={s.add}>
              <Icon name="plus" size={12} />
              Add an account
            </p>
          </section>
        ))}
      </div>
      <ul className={s.compact}>
        {AGENTS.map((agent, a) => (
          <li key={agent.id} style={{ '--a': a } as CSSProperties}>
            <span className={s.mark}>
              <AgentMark agent={agent.id} size={20} />
            </span>
            <b className={s.many}>{agent.plans.length}</b>
            <span className={s.what}>
              <b>{agent.id === Agent.OpenCode ? 'OpenCode plans and keys' : agent.noun}</b>
              <span>
                {agent.plans.map((plan, i) => (
                  <Fragment key={plan.name}>
                    {i > 0 && ' · '}
                    <span className={cx(plan.back && s.dim)}>{plan.short}</span>
                  </Fragment>
                ))}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
