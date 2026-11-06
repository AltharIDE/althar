// Scrappy: the kit as a thread's blocks see it here: an MCP call says its server, and one that acts reads stronger.
import type { ComponentProps } from 'react'

import { Tool as RealTool } from '../../../src/thread/Tool/Tool'
import { McpRow, mcpOf } from '../directions/tools/Calls'
import { useProto } from '../state'

export * from '../../../src/index'

export function Tool(props: ComponentProps<typeof RealTool>) {
  const p = useProto()
  if (p.surface !== 'tools' || p.direction === 'Today' || mcpOf(props.target) === null) return <RealTool {...props} />
  return <McpRow target={props.target} {...(props.state === undefined ? {} : { state: props.state })} />
}
