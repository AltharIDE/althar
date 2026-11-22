/** The agent's own command, sent bare as a turn of its own. */
export const COMPACT = '/compact'

/** Only ask agents whose ACP adapters run the command. Others can compact on their own. */
export const canCompact = (agentId: string) => agentId === 'claude-code' || agentId === 'codex' || agentId === 'opencode'

/** When to ask before the next turn. The lead's token limit also covers large windows. */
export const contextFull = (context: { readonly used: number; readonly size: number } | null, lead: boolean) =>
  context !== null && context.size > 0 && context.used >= Math.min(context.size * 0.8, lead ? 200_000 : Infinity)
