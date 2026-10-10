import type { AttentionRequest } from '@althar/contracts'
import { Permission, Permissions } from '@althar/ui'

import { permissionOf, type Reply, replyOf } from '../../shared/permissions'

/*
 * What the rules keep for the person: an agent's action that waits for them
 * to allow it once or always, or not, with a note or never again
 * (ADR-017). In a task's thread several wait as a stack, with Allow all;
 * in the dock beside the board, one.
 */

/** Answers a call: allowed or refused, with what to do instead, and kept as a rule by the scope of an always. */
export type AnswerCall = (
  attentionId: string,
  decision: Reply['decision'],
  reason?: string,
  always?: Reply['always'],
) => void | Promise<void>

const send = (onAnswer: AnswerCall, attentionId: string, reply: Reply) =>
  void onAnswer(attentionId, reply.decision, reply.reason, reply.always)

export function PermissionCall({ request, project, onAnswer }: { request: AttentionRequest; project: string; onAnswer: AnswerCall }) {
  return <Permission {...permissionOf(request)} project={project} onAnswer={(answer) => send(onAnswer, request.id, replyOf(answer))} />
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
  if (requests.length === 0) return null
  return (
    <Permissions
      items={requests.map(permissionOf)}
      project={project}
      onAnswer={(request, answer) => send(onAnswer, request.id, replyOf(answer))}
    />
  )
}
