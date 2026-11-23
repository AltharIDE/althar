import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

import type { Role } from './data'

/*
 * What a handoff story shows: the scene (the spec being written, the
 * handoff in design's inbox, a question back, the feature page, design's
 * lens), the lens on, the roles the person has in storefront, and what has
 * been pressed so far. Each story keeps its own, so a docs page with
 * several of them stays apart.
 */

export type Scene = 'spec' | 'handoff' | 'ask' | 'feature' | 'design'

export interface HandoffState {
  readonly scene: Scene
  readonly role: Role
  /** The person's roles in this project: several allowed, one looked through at a time. */
  readonly roles: readonly Role[]
  /** The "Your role here" dialog is open: on first run, or from the lens menu. */
  readonly picking: boolean
  readonly firstRun: boolean
  readonly menu: boolean
  /** The spec draft became its pull request. */
  readonly opened: boolean
  /** The proposed design tasks were accepted. */
  readonly accepted: boolean
  /** Design's question is sent, and product's answer. */
  readonly asked: boolean
  readonly answered: boolean
}

interface Handoff extends HandoffState {
  readonly set: (change: Partial<HandoffState>) => void
}

const Context = createContext<Handoff | null>(null)

export function HandoffProvider({ initial, children }: { initial: HandoffState; children: ReactNode }) {
  const [state, setState] = useState(initial)
  const value = useMemo(() => ({ ...state, set: (change: Partial<HandoffState>) => setState((now) => ({ ...now, ...change })) }), [state])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useHandoff = (): Handoff => {
  const one = useContext(Context)
  if (one === null) throw new Error('useHandoff outside HandoffProvider')
  return one
}
