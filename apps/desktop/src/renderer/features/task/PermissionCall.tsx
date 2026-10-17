import { useState } from 'react'

import type { AttentionRequest } from '@althar/contracts'
import { LinkButton, Permission, type PermissionFocus, Permissions } from '@althar/ui'

import { permissionOf, type Reply, replyOf } from '../../shared/permissions'

/*
 * What the rules keep for the person: an agent's action that waits for them
 * to allow it once or always, or not, with a note or never again
 * (ADR-018). In a task's thread several wait as a stack, with Allow all;
 * in the dock beside the board, one. One the project always asks about
 * offers no "always allow", and says so, with a way out where the screen
 * has one: allowing everything on the task (ADR-043), or the rules.
 */

export const text = {
  /** Under a card the project always asks about, whatever else would answer. */
  held: (project: string) => `${project} always asks you about this, so there’s no “always allow”.`,
  allowEverything: 'Allow everything on this task',
  rules: 'Change it in Rules',
}

/** The ways out of what the project always asks about, where the screen offers them. */
export interface WayOut {
  /** Allows everything on the task: what waits on it, this card among them, goes ahead. */
  readonly onAllowEverything?: () => void
  /** Opens the project's rules. */
  readonly onRules?: () => void
}

/** Why a card the project always asks about has no "always allow", with the ways out. */
function Held({ project, wayOut }: { project: string; wayOut: WayOut }) {
  const ways = [
    wayOut.onAllowEverything && (
      <LinkButton key="all" onClick={wayOut.onAllowEverything}>
        {text.allowEverything}
      </LinkButton>
    ),
    wayOut.onRules && (
      <LinkButton key="rules" onClick={wayOut.onRules}>
        {text.rules}
      </LinkButton>
    ),
  ].filter(Boolean)
  return (
    <>
      {text.held(project)}
      {ways.map((way, i) => (
        <span key={i}>
          {i === 0 ? ' ' : ' · '}
          {way}
        </span>
      ))}
    </>
  )
}

/** A call as its card shows it, saying why it has no "always allow" where the project always asks about it. */
const cardOf = (request: AttentionRequest, project: string, wayOut: WayOut) => ({
  ...permissionOf(request),
  ...(request.held === true ? { held: <Held project={project} wayOut={wayOut} /> } : {}),
})

/** Answers a call: allowed or refused, with what to do instead, and kept as a rule by the scope of an always; false where it didn't go through. */
export type AnswerCall = (
  attentionId: string,
  decision: Reply['decision'],
  reason?: string,
  always?: Reply['always'],
) => void | Promise<unknown>

/**
 * Sends answers, and starts the cards afresh when one doesn't go through, so
 * every call still waiting can be answered again: the kit's card keeps an
 * answer once given, the runtime only once it took it.
 */
const useAnswers = (onAnswer: AnswerCall) => {
  const [round, setRound] = useState(0)
  const send = (attentionId: string, reply: Reply) =>
    void Promise.resolve(onAnswer(attentionId, reply.decision, reply.reason, reply.always)).then((through) => {
      if (through === false) setRound((now) => now + 1)
    })
  return { round, send }
}

/** Takes focus as the cards first show; started afresh after an answer that didn't go through, only while nothing else has it, so it never takes it back from what the person moved on to. */
const afresh = (focus: PermissionFocus | undefined, round: number) => (round === 0 || !focus ? focus : 'idle')

export function PermissionCall({
  request,
  project,
  onAnswer,
  focusOnMount,
  wayOut = {},
}: {
  request: AttentionRequest
  project: string
  onAnswer: AnswerCall
  /** Takes focus as it shows, so Enter answers it (the kit's `PermissionFocus`). */
  focusOnMount?: PermissionFocus
  wayOut?: WayOut
}) {
  const { round, send } = useAnswers(onAnswer)
  return (
    <Permission
      key={round}
      {...cardOf(request, project, wayOut)}
      project={project}
      focusOnMount={afresh(focusOnMount, round)}
      onAnswer={(answer) => send(request.id, replyOf(answer))}
    />
  )
}

/** The task's permission calls, as one stack: each answer goes back to its own agent. */
export function PermissionCalls({
  requests,
  project,
  onAnswer,
  focusOnMount,
  wayOut = {},
}: {
  requests: ReadonlyArray<AttentionRequest>
  project: string
  onAnswer: AnswerCall
  /** The first card takes focus as it shows, so Enter answers it; the kit's `PermissionFocus`. */
  focusOnMount?: PermissionFocus
  wayOut?: WayOut
}) {
  const { round, send } = useAnswers(onAnswer)
  if (requests.length === 0) return null
  return (
    <Permissions
      key={round}
      items={requests.map((request) => cardOf(request, project, wayOut))}
      project={project}
      focusOnMount={afresh(focusOnMount, round)}
      onAnswer={(request, answer) => send(request.id, replyOf(answer))}
    />
  )
}
