import { useNavigate } from '@tanstack/react-router'

/*
 * Where an error takes the person to put it right, in Althar's settings:
 * an agent's sign-in, started, for an agent that is signed out; the code
 * hosts and trackers, for one that no longer takes Althar's sign-in.
 */

export interface SettingsWays {
  /** Opens the agent's tab with its sign-in started, by the agent's id. */
  readonly signIn: (agentId: string) => void
  /** Opens the agents, to sign one in. */
  readonly agents: () => void
  /** Opens the code hosts and trackers, to connect one or sign in to it again. */
  readonly connections: () => void
}

export const useSettingsWays = (): SettingsWays => {
  const navigate = useNavigate()
  return {
    signIn: (agentId) => void navigate({ to: '/settings/$section', params: { section: 'agents' }, search: { signIn: agentId } }),
    agents: () => void navigate({ to: '/settings/$section', params: { section: 'agents' } }),
    connections: () => void navigate({ to: '/settings/$section', params: { section: 'code-hosts' } }),
  }
}
