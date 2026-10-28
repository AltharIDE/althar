import { createElement, isValidElement } from 'react'

import * as board from '../../../../../../packages/ui/src/fixtures/board'
import * as coordinator from '../../../../../../packages/ui/src/fixtures/coordinator'
import * as edge from '../../../../../../packages/ui/src/fixtures/edge'
import * as home from '../../../../../../packages/ui/src/fixtures/home'
import * as marks from '../../../../../../packages/ui/src/fixtures/marks'
import * as review from '../../../../../../packages/ui/src/fixtures/meridian'

/*
 * The kit's demo world, as the site shows it: a payments API and its
 * neighbours, read from the kit's source (ported, the site would keep its
 * own copy). The kit calls the payments project Meridian; the site calls it
 * Tally, so every name, repository and issue key in the data is said again
 * here, once, before any picture draws it. The rest of the world is as the
 * kit has it.
 */

/** The made-up project the site's pictures show. */
export const PROJECT_NAME = 'Tally'

const say = (text: string) =>
  text
    .replace(/Meridian/g, PROJECT_NAME)
    .replace(/meridian/g, PROJECT_NAME.toLowerCase())
    .replace(/MERIDIAN/g, PROJECT_NAME.toUpperCase())
    .replace(/\bMER-/g, `${PROJECT_NAME.slice(0, 3).toUpperCase()}-`)

/** A copy of `x` with the project's name said the site's way: in its strings, its arrays, its plain objects and the elements it holds. */
export function renamed<T>(x: T): T {
  if (typeof x === 'string') return say(x) as T
  if (Array.isArray(x)) return x.map(renamed) as T
  if (isValidElement(x)) return createElement(x.type, { ...renamed(x.props as Record<string, unknown>), key: x.key ?? undefined }) as T
  if (x && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x)))
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, renamed(v)])) as T
  return x
}

export const { CALLS, NEXT, READY_TWO_REPOS, SETTLED } = renamed({ ...board })
export const { DRAFT_LINEAR, FROM_231, PLAN_432 } = renamed({ ...coordinator })
export const { EDGE_NEEDS, EDGE_WORK, NOTCH } = renamed({ ...edge })
export const { edgeLineOf } = edge
export const { HALYARD, MERIDIAN: TALLY } = renamed({ ...home })
export const { MARKED } = renamed({ ...marks })
export const { FINDINGS, PROJECT, reviewDoc, STEPS } = renamed({ ...review })
