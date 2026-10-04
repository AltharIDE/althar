import type { AttentionRequest } from '@althar/contracts'
import { Decision, Permission } from '@althar/ui'

/*
 * What the rules keep for the person: an agent's action that waits for them
 * to allow it, or not, with a note. In a task's thread, and in the dock
 * beside the board.
 */
export function PermissionCall({
  request,
  project,
  onAnswer,
}: {
  request: AttentionRequest
  project: string
  onAnswer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => void | Promise<void>
}) {
  return (
    <Permission
      id={request.id}
      what={request.title}
      cmd={request.command ?? request.title}
      why={request.reason}
      offers={[Decision.AllowOnce, Decision.Deny]}
      project={project}
      onAnswer={(answer) =>
        void onAnswer(
          request.id,
          answer.decision === Decision.AllowOnce ? 'allow' : 'reject',
          answer.decision === Decision.Deny ? answer.note : undefined,
        )
      }
    />
  )
}
