import { type ComponentProps, useEffect, useState, useSyncExternalStore } from 'react'

import { Button, Icon, LinkButton } from '@althar/ui'

import { ThreadBlocks as AppThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { broughtOf } from './data'
import { Mark } from './Found'
import { AGENTS, TOOLS, when } from './world'
import s from './threads.module.css'

export * from '../../src/renderer/shared/ThreadBlocks'

/*
 * A thread's blocks, as the app draws them, and for one brought in from
 * another tool, where it came from over them and how it goes on under them.
 * A worktree's task says its folder and the conversations that ran there; a
 * chat its agent and date. Continuing picks up the agent's own session where
 * the agent can load one (Claude Code, as a copy, so its own stays as it
 * was); else it starts a new session from a brief of this one (Codex here).
 */

/** The thread brought in that's on show, for its composer to say how it goes on (TaskFace, in Seams.tsx). */
let shown: string | null = null
const listeners = new Set<() => void>()
const showing = (threadId: string | null) => {
  shown = threadId
  for (const listener of listeners) listener()
}
export const useShownBrought = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => shown,
  )

export function ThreadBlocks(props: ComponentProps<typeof AppThreadBlocks>) {
  const brought = broughtOf(props.threadId)
  const any = brought !== null && brought.conversations.length > 0
  useEffect(() => {
    if (!any) return
    showing(props.threadId)
    return () => {
      if (shown === props.threadId) showing(null)
    }
  }, [any, props.threadId])
  if (brought === null || !any) return <AppThreadBlocks {...props} />
  // A thread may be drawn in parts (its earlier turns, then its latest): where it came from heads the part with its first words.
  const oldest = brought.conversations.at(-1)
  const first = oldest !== undefined && JSON.stringify(props.blocks).includes(`"${oldest.id}-0"`)
  return (
    <>
      {first && <Origin brought={brought} />}
      <AppThreadBlocks {...props} />
    </>
  )
}

type Brought = NonNullable<ReturnType<typeof broughtOf>>

function Origin({ brought }: { brought: Brought }) {
  const { worktree, conversations } = brought
  return (
    <section className={s.origin} aria-label="Brought in">
      {worktree !== undefined && (
        <div className={s.originRow}>
          <Mark of={worktree.tool} size={16} />
          <div className={s.originMain}>
            <span className={s.originTitle}>From {TOOLS[worktree.tool].name}</span>
            <code className={s.mono}>{worktree.path}</code>
          </div>
        </div>
      )}
      {conversations.map((one) => (
        <div key={one.id} className={s.originRow}>
          <Mark of={one.agent} size={16} />
          <div className={s.originMain}>
            <span className={s.originTitle}>{worktree === undefined ? `From ${AGENTS[one.agent].name}` : one.title}</span>
            <span className={s.originFacts}>
              {worktree !== undefined && <span>{AGENTS[one.agent].name}</span>}
              <span>{one.messages} messages</span>
              <span>{when(one.at)}</span>
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}

/** How a conversation brought in goes on: over its composer. */
export function GoOn({ threadId }: { threadId: string }) {
  const brought = broughtOf(threadId)
  return brought === null ? null : <GoingOn key={threadId} brought={brought} />
}

function GoingOn({ brought }: { brought: Brought }) {
  const [going, setGoing] = useState<'session' | 'brief' | null>(null)
  const last = brought.conversations[0]
  if (last === undefined) return null
  const agent = AGENTS[last.agent]
  const where = brought.worktree === undefined ? null : `${TOOLS[brought.worktree.tool].name}’s folder`
  if (going !== null)
    return (
      <p className={s.going}>
        <Icon name="check" size={12} />
        {going === 'session'
          ? `Continuing in ${agent.name}, from a copy of its session${where === null ? '' : `, in ${where}`}.`
          : `A new ${agent.name} session starts from a brief of this one.`}
      </p>
    )
  return (
    <section className={s.goOn}>
      <Mark of={last.agent} size={16} />
      <div className={s.goOnMain}>
        <span className={s.goOnTitle}>{agent.resumes ? `Continue in ${agent.name}, from its own session` : `Continue from a brief`}</span>
        <span className={s.goOnLine}>
          {agent.resumes
            ? `A copy: the session in ${agent.where} stays as it was.`
            : `${agent.name}’s session can’t be loaded here, so a new one starts from what was said.`}
        </span>
      </div>
      <div className={s.goOnActions}>
        <LinkButton onClick={() => setGoing('brief')}>{agent.resumes ? 'From a brief' : 'Another agent…'}</LinkButton>
        <Button size="small" onClick={() => setGoing(agent.resumes ? 'session' : 'brief')}>
          Continue
        </Button>
      </div>
    </section>
  )
}
