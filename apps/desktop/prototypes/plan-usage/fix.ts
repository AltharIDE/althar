// Scrappy: the one word steering changes in the app, in every direction. Work held for an agent that is only nearly out says it waits for it, not that the agent is out of usage (`shared/agents.ts` waitsWords); held for one that is out, the app's words stand.
import { steerOf } from './data'
import { get } from './store'

const held: Readonly<Record<string, string>> = { review: 'The review waits', settle: 'The fixes wait' }

export const waits = (agent: string, at: string, step?: string | null): string | null => {
  const steer = steerOf(get())
  if (steer === null || steer.action !== 'waits' || steer.left === 0) return null
  return step === undefined ? `Waiting for ${agent} until ${at}` : `${held[step ?? ''] ?? 'The work waits'} for ${agent} until ${at}`
}
