import type { AttentionRequest } from '@althar/contracts'
import { commandGlance } from '@althar/ui'

/*
 * A permission's command on the board, the home and the glance: said once,
 * short. What the agent asked is often the command itself, so the title
 * keeps to its first line, and the command is left out where the title is it.
 * The whole of it is in the task, where the permission's card shows every line.
 */

type Call = Pick<AttentionRequest, 'title' | 'command' | 'label'>

const MULTI = /\n|^.{121,}/s

/** What the agent asked, on one line. */
export const titleOf = (call: Pick<Call, 'title'>): string =>
  MULTI.test(call.title) ? (commandGlance(call.title).lines[0] ?? call.title) : call.title

/** The command to show under the title, as it reads at a glance; none where the title is the command and is short. */
export const commandOf = (call: Call): { readonly command: string } | Record<string, never> => {
  const command = call.command ?? call.title
  return call.command === call.title && !MULTI.test(command) ? {} : { command: call.label ?? command }
}
