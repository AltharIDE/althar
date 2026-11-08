import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { WINDOW_ACTIONS } from '@althar/runtime/windowActions'
import { describe, expect, it } from 'vitest'

import type { TaskModel } from '../src/renderer/features/task/useTask'

/*
 * Every button the person has on a task is listed in the runtime's
 * WINDOW_ACTIONS, with the tool the coordinator and the leads do it with, or
 * why there is none (ADR-097, "Matching the window"). The runtime's test
 * checks each tool is one both roles have; this one that the list is the
 * task model's actions, no more and no fewer.
 */

/** The task model's actions: each of its members that is a function. */
type Actions<T> = { [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]

// Checked as the app is: an action the model gains without a line in WINDOW_ACTIONS fails here, and so does a line for one it lost.
const listed: Readonly<Record<Actions<TaskModel>, unknown>> = WINDOW_ACTIONS
const named: Readonly<Record<keyof typeof WINDOW_ACTIONS, unknown>> = {} as Readonly<Record<Actions<TaskModel>, unknown>>

/** The model's actions as its interface declares them, read from the source, so the test fails without the type check too. */
const declared = () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'renderer', 'features', 'task', 'useTask.ts'), 'utf8')
  const body = /export interface TaskModel \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  return [...body.matchAll(/^ {2}readonly (\w+): (?:\(|<)/gm)].map((match) => match[1]).toSorted()
}

describe('the window’s task actions', () => {
  it('are each listed with the tool that does it, or why there is none', () => {
    expect(Object.keys(listed).length).toBeGreaterThan(0)
    expect(named).toBeDefined()
    expect(Object.keys(WINDOW_ACTIONS).toSorted()).toEqual(declared())
  })
})
