import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

/*
 * What a role-lenses story shows: the direction (A Minimal, B Panels, C
 * Feature-first), the lens on, the feature whose timeline is open, the lens
 * menu open, and the panels pinned or taken off in B. Each story keeps its
 * own, so a docs page with several of them stays apart.
 */

export const DIRECTIONS = [
  { key: 'a', label: 'Minimal' },
  { key: 'b', label: 'Panels' },
  { key: 'c', label: 'Feature-first' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export const ROLES = [
  { key: 'product', kbd: '1', label: 'Product' },
  { key: 'design', kbd: '2', label: 'Design' },
  { key: 'engineering', kbd: '3', label: 'Engineering' },
  { key: 'devops', kbd: '4', label: 'DevOps' },
] as const
export type Role = (typeof ROLES)[number]['key']
export const roleName = (role: Role) => ROLES.find((one) => one.key === role)?.label ?? role

export interface LensState {
  readonly d: Direction
  readonly role: Role
  readonly feature: string | null
  readonly menu: boolean
  readonly pinned: ReadonlyArray<string>
  readonly unpinned: ReadonlyArray<string>
}

interface Lens extends LensState {
  readonly set: (change: Partial<LensState>) => void
}

const Context = createContext<Lens | null>(null)

export function LensProvider({ initial, children }: { initial: LensState; children: ReactNode }) {
  const [state, setState] = useState(initial)
  const value = useMemo(() => ({ ...state, set: (change: Partial<LensState>) => setState((now) => ({ ...now, ...change })) }), [state])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useLens = (): Lens => {
  const lens = useContext(Context)
  if (lens === null) throw new Error('useLens outside LensProvider')
  return lens
}
