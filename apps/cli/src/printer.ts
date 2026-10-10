import type { LiveEvent } from '@althar/runtime'

/*
 * What happens on the thread, as terminal output. The agent's message streams
 * as it arrives; everything else is one line, so the record reads top to
 * bottom as it happened.
 */

export interface Printer {
  /** The text to write for an event; empty when there is nothing to show. */
  print(event: LiveEvent): string
  /** The question waiting for the person, if there is one. */
  readonly waiting: string | undefined
}

export const printer = (threadId: string): Printer => {
  let streaming = false
  let thinking = false
  let waiting: string | undefined
  const tools = new Map<string, string>()

  /** Starts a line of its own, ending a streamed message or the thinking mark first. */
  const line = (text: string) => {
    const before = streaming || thinking ? '\n' : ''
    streaming = false
    thinking = false
    return `${before}${text}\n`
  }

  const print = (event: LiveEvent): string => {
    if (event.threadId !== threadId) return ''
    switch (event._tag) {
      case 'SessionStarted':
        return line(`● ${event.agentId}${event.model === undefined ? '' : ` (${event.model})`} started.`)
      case 'SessionEnded':
        return line(`● The session ended: ${event.state}.`)
      case 'TurnStarted':
      // The agent's own events already stream the message here; a command's output is the window's to show.
      case 'Streaming':
      case 'Output':
        return ''
      case 'TurnEnded':
        return line(`— ${event.state}${event.errorClass === undefined ? '' : ` (${event.errorClass})`}`)
      case 'AttentionNeeded':
        waiting = event.attentionId
        return line(`? ${event.title}\n  ${event.reason} Answer with /allow or /reject [reason].`)
      case 'AttentionClosed':
        if (waiting === event.attentionId) waiting = undefined
        return event.outcome === 'withdrawn' ? line('? The question was withdrawn.') : ''
      case 'Agent': {
        const agent = event.event
        switch (agent._tag) {
          case 'AgentMessage': {
            const text = streaming ? agent.text : `${thinking ? '\n' : ''}${agent.text}`
            streaming = true
            thinking = false
            return text
          }
          case 'AgentThought':
            if (thinking) return ''
            thinking = true
            if (!streaming) return '· thinking'
            streaming = false
            return '\n· thinking'
          case 'ToolCall':
            tools.set(agent.toolCallId, agent.title)
            return line(`→ ${agent.title}`)
          case 'ToolCallUpdate': {
            if (agent.title !== undefined) tools.set(agent.toolCallId, agent.title)
            if (agent.status !== 'completed' && agent.status !== 'failed') return ''
            return line(`  ${agent.status === 'completed' ? '✓' : '✗'} ${tools.get(agent.toolCallId) ?? ''}`.trimEnd())
          }
          case 'Plan':
            return line(
              ['Plan:', ...agent.entries.map((entry) => `  ${entry.status === 'completed' ? '✓' : '·'} ${entry.content}`)].join('\n'),
            )
          case 'Notice':
            return line(`! ${agent.title}`)
          case 'AgentFailure':
            return line(`! ${agent.classified.message}`)
          case 'PermissionAnswered':
            return line(`  ${agent.decision === 'allow' ? 'allowed' : 'rejected'}${agent.optionId === null ? '' : ` (${agent.optionId})`}`)
          case 'Resumed':
            return line('  resumed after the rejection')
          case 'ModeChanged':
            return agent.byAgent ? line(`● The agent moved to its ${agent.modeId} mode.`) : ''
          default:
            return ''
        }
      }
    }
  }

  return {
    print,
    get waiting() {
      return waiting
    },
  }
}
