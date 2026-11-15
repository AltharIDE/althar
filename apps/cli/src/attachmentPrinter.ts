import type { ThreadSnapshot, WatchEvent } from '@althar/contracts'

// Host and agent text is untrusted terminal data: never allow cursor movement, OSC clipboard writes or C1 controls.
// oxlint-disable-next-line no-control-regex -- Explicitly remove terminal control bytes from remote data.
export const terminalText = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

export const attachmentPrinter = () => {
  const seen = new Map<string, string>()
  let version: number | undefined
  let session: string | undefined
  let attention = new Set<string>()
  let active: string | undefined
  const remember = (id: string, text: string) => {
    seen.delete(id)
    seen.set(id, text)
    if (seen.size > 500) seen.delete(seen.keys().next().value!)
  }
  const text = (id: string, value: string, prefix = '') => {
    // With at most 500 entries, even hostile or very long cumulative messages have a fixed cache/output bound.
    if (value.length > 65_536) value = `${value.slice(0, 65_536)}\n[Item truncated; view its full contents in the desktop.]`
    const before = seen.get(id)
    if (before === value || (before !== undefined && before.startsWith(value))) return ''
    remember(id, value)
    const wasActive = active === id
    active = id
    if (before !== undefined && value.startsWith(before))
      return `${wasActive ? '' : '\n[continued] '}${terminalText(value.slice(before.length))}`
    return `\n${before === undefined ? prefix : '[revised] '}${terminalText(value)}`
  }
  return {
    streaming: (event: Extract<WatchEvent, { _tag: 'Streaming' }>) =>
      text(event.itemId, event.text, event.kind === 'agent_thought' ? '· ' : ''),
    snapshot: (snapshot: ThreadSnapshot) => {
      let out = ''
      if (version !== undefined && version !== snapshot.conversationVersion) {
        seen.clear()
        out += '\n[Conversation changed; refreshed]\n'
      }
      version = snapshot.conversationVersion
      const state = snapshot.session === null ? 'No agent is running.' : `${snapshot.session.agentName}: ${snapshot.session.state}`
      if (state !== session) {
        active = undefined
        session = state
        out += `\n● ${terminalText(state)}\n`
      }
      for (const item of snapshot.items) {
        switch (item.kind) {
          case 'agent_message':
          case 'agent_thought':
          case 'user_message':
            out += text(item.id, item.content.text, item.kind === 'user_message' ? 'You: ' : item.kind === 'agent_thought' ? '· ' : '')
            break
          case 'tool_call':
            out += text(item.id, `${item.content.status}: ${item.content.title}`, '→ ')
            break
          case 'notice':
            out += text(item.id, `${item.content.title}${item.content.description === null ? '' : `\n${item.content.description}`}`, '! ')
            break
        }
      }
      for (const request of snapshot.attention)
        if (!attention.has(request.id))
          out += `\n? ${terminalText(request.title)}\n${terminalText(request.reason)}\nAnswer in a trusted person client. This SSH/socket client cannot approve it.\n`
      attention = new Set(snapshot.attention.map((request) => request.id))
      return out
    },
  }
}
