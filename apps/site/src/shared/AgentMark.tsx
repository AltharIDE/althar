import { Brand, BrandMark } from '@althar/ui'

import { Agent } from '../content/agents'

const BRAND_OF: Partial<Record<Agent, Brand>> = {
  [Agent.Claude]: Brand.ClaudeCode,
  [Agent.Codex]: Brand.Codex,
  [Agent.Gemini]: Brand.GeminiCli,
}

/** An agent's mark, in the text colour. OpenCode has none in @althar/ui, so it gets a plain square. */
export function AgentMark({ agent, size = 16, className }: { agent: Agent; size?: number; className?: string }) {
  const brand = BRAND_OF[agent]
  if (brand) return <BrandMark brand={brand} size={size} className={className} />
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="10" width="8" height="7" fill="currentColor" />
    </svg>
  )
}
