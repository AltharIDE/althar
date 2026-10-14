import type { ReactNode } from 'react'

import { TODAY } from './url'

/*
 * A prototype, as the workbench takes it: its directions, each a way the
 * thing could go, drawn by a render function; the states each shows, such
 * as nothing to push, pushing, pushed; the data they are drawn from; and
 * Today, the app as it is, where the prototype draws it for comparison.
 */

/** What a direction is drawn with. */
export interface View<F> {
  /** The direction drawn, by key: A, or `today`. */
  readonly direction: string
  /** The state shown, by key; '' where the prototype has none. */
  readonly state: string
  /** The prototype's data, for that state. */
  readonly fixtures: F
  /** Drawn beside the others, side by side, rather than alone. */
  readonly side: boolean
}

export interface Direction<F> {
  /** Its key, in the bar and the address: A, B, C. */
  readonly key: string
  /** What it does differently, in a few words: Push in the foot. */
  readonly name: string
  readonly render: (view: View<F>) => ReactNode
}

export interface State {
  /** Its key, in the address: pushing. */
  readonly key: string
  /** Its name in the bar: Pushing. */
  readonly name: string
}

export interface Prototype<F = undefined> {
  /** What is being prototyped, in a few words: Board card, push state. */
  readonly title: string
  /** The ways it could go, in the order the bar shows them. */
  readonly directions: readonly Direction<F>[]
  /** The states every direction shows, in order; the first is shown first. */
  readonly states?: readonly State[]
  /** The app as it is today, drawn the same way, for comparison. */
  readonly today?: { readonly name?: string; readonly render: (view: View<F>) => ReactNode }
  /** The data the directions are drawn from, for the state shown. */
  readonly fixtures?: (state: string) => F
  /** The width the directions are designed at, in pixels: side by side, each is scaled down to fit its column. */
  readonly width?: number
}

/** Declares a prototype, typed by its fixtures: what a prototype's `prototype.tsx` exports by default. */
export const prototype = <F = undefined>(definition: Prototype<F>): Prototype<F> => definition

/** What is wrong with a prototype, as the page says it in place of the prototype. */
export const problemsOf = <F>(definition: Prototype<F>): string[] => {
  const problems: string[] = []
  if (definition.directions.length === 0) problems.push('It has no directions: give it at least one, as { key, name, render }.')
  // Each key given twice, in any case, once, as it was first written.
  const twice = (keys: readonly string[]) => {
    const first = (key: string) => keys.find((other) => other.toLowerCase() === key.toLowerCase()) ?? key
    return new Set(keys.filter((key, at) => keys.indexOf(first(key)) !== at).map(first))
  }
  const directions = definition.directions.map((direction) => direction.key)
  for (const key of twice(directions)) problems.push(`Two directions have the key ${key}: each needs its own.`)
  for (const key of twice((definition.states ?? []).map((state) => state.key)))
    problems.push(`Two states have the key ${key}: each needs its own.`)
  if (directions.some((key) => key.toLowerCase() === TODAY)) problems.push(`A direction can’t have the key ${TODAY}: it is kept for Today.`)
  if ([...directions, ...(definition.states ?? []).map((state) => state.key)].some((key) => key.trim() === '' || key.includes(',')))
    problems.push('A key is empty or has a comma in it: keys go in the address, as ?d=A&s=pushing.')
  return problems
}
