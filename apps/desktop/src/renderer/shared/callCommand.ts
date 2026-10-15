import type { AttentionRequest } from '@althar/contracts'
import { commandGlance } from '@althar/ui'

/*
 * A permission's command on the board, the home and the glance: said once,
 * short. What the agent asked is often the command itself, so the title
 * keeps to its first line, and the command is left out where the title is it.
 * The whole of it is in the task, where the permission's card shows every line.
 */

type Call = Pick<AttentionRequest, 'title' | 'command' | 'label'>

const LONG = /\n|^.{121,}/s

/** Whether the title is the command itself, and says more than one short command. */
const isScript = (call: Call): boolean => {
  const command = call.command ?? call.title
  if (call.command !== null && call.command !== call.title && !LONG.test(call.title)) return false
  if (LONG.test(command)) return true
  const { lines, summary } = commandGlance(command)
  return lines.length > 1 || summary !== null
}

/** What the agent asked, on one line: its title, or where that is the command, a plain heading above the command. */
export const titleOf = (call: Call): string => {
  if (!isScript(call)) return call.title
  return LONG.test(call.command ?? call.title) || (call.command ?? call.title).includes('\n') ? 'Run a script' : 'Run commands'
}

/** The command to show under the title, as it reads at a glance; none where the title is the command and is one short command. */
export const commandOf = (call: Call): { readonly command: string } | Record<string, never> => {
  const command = call.command ?? call.title
  return call.command === call.title && !isScript(call) ? {} : { command: call.label ?? command }
}
