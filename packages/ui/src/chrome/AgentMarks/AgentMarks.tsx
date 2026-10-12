import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { RuntimeState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './AgentMarks.module.css'

/*
 * The agents on this machine, in the window's bar: a mark for each, and
 * nothing more while it is ready. Only an agent that isn't says so, in a
 * word or two beside its mark: out until its reset, signed out. Signed out is
 * violet, because only a person can sign it in. Setting agents up lives
 * elsewhere; this is where you notice one needs it.
 */

export interface AgentMarksText {
  label: string
  state: Record<Exclude<RuntimeState, RuntimeState.OutOfUsage>, string>
  /** Out of usage, with when it is back: 14:20. */
  out: (back: string | undefined) => string
}

export const agentMarksText: AgentMarksText = {
  label: 'Agents',
  state: {
    [RuntimeState.Ready]: 'ready',
    [RuntimeState.Checking]: 'checking',
    [RuntimeState.SigningIn]: 'signing in',
    [RuntimeState.SignedOut]: 'signed out',
    [RuntimeState.Missing]: 'not installed',
    [RuntimeState.Installing]: 'downloading',
    [RuntimeState.Outdated]: 'needs an update',
  },
  out: (back) => (back ? `out until ${back}` : 'out of usage'),
}

export interface AgentMark {
  id: string
  name: string
  /** Its mark; without one, its name is shown. */
  brand?: Brand
  state: RuntimeState
  /** When an agent out of usage is back: 14:20. */
  back?: string
}

export type AgentMarksProps = RootProps<'ul', { agents: readonly AgentMark[]; text?: Partial<AgentMarksText> }>

/** What an agent says beside its mark, and how loudly: nothing while it's ready. */
function say(agent: AgentMark, t: AgentMarksText): { words: string; shown: boolean; tone?: string } {
  switch (agent.state) {
    case RuntimeState.Ready:
      return { words: t.state[RuntimeState.Ready], shown: false }
    case RuntimeState.OutOfUsage:
      return { words: t.out(agent.back), shown: true, tone: s.out }
    case RuntimeState.SignedOut:
      return { words: t.state[RuntimeState.SignedOut], shown: true, tone: s.you }
    case RuntimeState.Checking:
    case RuntimeState.SigningIn:
    case RuntimeState.Missing:
    case RuntimeState.Installing:
    case RuntimeState.Outdated:
      return { words: t.state[agent.state], shown: true }
    default:
      return unreachable(agent.state)
  }
}

export function AgentMarks({ agents, className, text, ...rest }: AgentMarksProps) {
  const t = { ...agentMarksText, ...text }
  return (
    <ul aria-label={t.label} className={cx(s.agents, className)} {...rest}>
      {agents.map((agent) => {
        const said = say(agent, t)
        return (
          <li key={agent.id} className={cx(s.agent, said.tone)}>
            {agent.brand ? (
              <>
                <BrandMark brand={agent.brand} size={13} />
                <VisuallyHidden>{agent.name}</VisuallyHidden>
              </>
            ) : (
              <span className={s.name}>{agent.name}</span>
            )}
            {said.shown ? <span className={s.words}>{said.words}</span> : <VisuallyHidden>{said.words}</VisuallyHidden>}
          </li>
        )
      })}
    </ul>
  )
}
