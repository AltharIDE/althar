/*
 * What a line typed at the prompt asks for. Plain text goes to the agent,
 * after the turn running; a line starting with `/` is a command.
 */

export type Action =
  | { readonly _tag: 'Say'; readonly text: string }
  | { readonly _tag: 'Interrupt'; readonly text: string }
  | { readonly _tag: 'Model'; readonly model: string }
  | { readonly _tag: 'Agent'; readonly agent: string; readonly model?: string }
  | { readonly _tag: 'Answer'; readonly decision: 'allow' | 'reject'; readonly reason?: string }
  | { readonly _tag: 'Stop' }
  | { readonly _tag: 'Quit' }
  | { readonly _tag: 'Help' }
  | { readonly _tag: 'Nothing' }
  | { readonly _tag: 'Unknown'; readonly message: string }

export const HELP = `Type to talk to the agent; it reads your message when its turn ends.
  /interrupt <text>        stop the turn, and say this first
  /model <id>              change the model; the session carries on
  /agent <id> [model]      hand the task to another agent: claude-code, codex, opencode
  /allow [reason]          answer the question waiting for you
  /reject [reason]
  /stop                    stop the session
  /quit                    stop everything and leave`

export const parseLine = (line: string): Action => {
  const text = line.trim()
  if (text === '') return { _tag: 'Nothing' }
  if (!text.startsWith('/')) return { _tag: 'Say', text }
  const [command = '', ...words] = text.slice(1).split(/\s+/)
  const rest = words.join(' ')
  switch (command) {
    case 'interrupt':
    case 'i':
      return rest === '' ? { _tag: 'Unknown', message: 'Say what to do instead: /interrupt <text>' } : { _tag: 'Interrupt', text: rest }
    case 'model':
      return words.length === 1 && words[0] !== undefined
        ? { _tag: 'Model', model: words[0] }
        : { _tag: 'Unknown', message: 'Name one model: /model <id>' }
    case 'agent': {
      const [agent, model] = words
      if (agent === undefined || words.length > 2) return { _tag: 'Unknown', message: 'Name the agent: /agent <id> [model]' }
      return { _tag: 'Agent', agent, ...(model === undefined ? {} : { model }) }
    }
    case 'allow':
    case 'reject':
      return { _tag: 'Answer', decision: command, ...(rest === '' ? {} : { reason: rest }) }
    case 'stop':
      return { _tag: 'Stop' }
    case 'quit':
    case 'exit':
      return { _tag: 'Quit' }
    case 'help':
    case '?':
      return { _tag: 'Help' }
    default:
      return { _tag: 'Unknown', message: `There is no /${command}. Type /help for the commands.` }
  }
}
