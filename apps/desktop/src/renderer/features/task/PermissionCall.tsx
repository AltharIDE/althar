import { useState } from 'react'

import type { AttentionRequest } from '@althar/contracts'
import { Permission, Permissions } from '@althar/ui'

import { permissionOf, type Reply, replyOf } from '../../shared/permissions'

/*
 * What the rules keep for the person: an agent's action that waits for them
 * to allow it once or always, or not, with a note or never again
 * (ADR-018). In a task's thread several wait as a stack, with Allow all;
 * in the dock beside the board, one.
 */

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

export function PermissionCall({ request, project, onAnswer }: { request: AttentionRequest; project: string; onAnswer: AnswerCall }) {
  const { round, send } = useAnswers(onAnswer)
  return <Permission key={round} {...permissionOf(request)} project={project} onAnswer={(answer) => send(request.id, replyOf(answer))} />
}

/** The task's permission calls, as one stack: each answer goes back to its own agent. */
export function PermissionCalls({
  requests,
  project,
  onAnswer,
}: {
  requests: ReadonlyArray<AttentionRequest>
  project: string
  onAnswer: AnswerCall
}) {
  const { round, send } = useAnswers(onAnswer)
  if (requests.length === 0) return null
  return (
    <Permissions
      key={round}
      items={requests.map(permissionOf)}
      project={project}
      onAnswer={(request, answer) => send(request.id, replyOf(answer))}
    />
  )
}
