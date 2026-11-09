import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import type { NewProjectDefaults, ProjectRulesView } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Where a project's own rules differ from what new projects start with
 * (Settings › Tasks): for each of the template's rows, the projects that have
 * another value, and the way to bring them in line, "Use this in every
 * project". The template only reaches projects made from then on, so a project
 * that has its own is shown, never changed behind the person's back.
 */

export type DefaultKey = keyof NewProjectDefaults

/** The keys of the template that a project's rules also have. */
export const DEFAULT_KEYS: ReadonlyArray<DefaultKey> = [
  'end',
  'pushCommits',
  'postScreenshots',
  'resolveConflicts',
  'moveIssues',
  'usageLimit',
  'rotateAccounts',
]

/** A project's value for a key, as the template says it: no choice of how a task ends is a draft, where Althar is connected. */
export const valueIn = (rules: ProjectRulesView, key: DefaultKey): NewProjectDefaults[DefaultKey] =>
  key === 'end' ? (rules.end ?? 'draft') : rules[key]

export interface Differing {
  readonly id: string
  readonly name: string
  /** What it has, as the template's value for the key. */
  readonly value: NewProjectDefaults[DefaultKey]
}

export interface DifferingModel {
  /** By row: the projects that have another value. A row with none isn't there. */
  readonly differing: Partial<Record<DefaultKey, ReadonlyArray<Differing>>>
  /** Sets the template's value in every project that has another for the row. */
  readonly inEveryProject: (key: DefaultKey) => void
  /** The row being brought in line. */
  readonly busy: DefaultKey | null
  readonly failed: string | null
}

/** The projects whose rules differ from the template; none until each project's rules are read. */
export const useDifferingProjects = (defaults: NewProjectDefaults | null): DifferingModel => {
  const { client, cache } = useServices()
  const listed = useQuery(reads(client).projects()).data?.projects
  const projects = useMemo(() => listed ?? [], [listed])
  const rules = useQueries({ queries: projects.map((project) => reads(client).rules(project.id)) })
  const [busy, setBusy] = useState<DefaultKey | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const differing: Partial<Record<DefaultKey, ReadonlyArray<Differing>>> = {}
  if (defaults !== null)
    for (const key of DEFAULT_KEYS) {
      const found = projects.flatMap((project, at): ReadonlyArray<Differing> => {
        const view = rules[at]?.data
        if (view === undefined) return []
        const value = valueIn(view, key)
        return value === defaults[key] ? [] : [{ id: project.id, name: project.name, value }]
      })
      if (found.length > 0) differing[key] = found
    }

  const inEveryProject = useCallback(
    (key: DefaultKey) => {
      if (defaults === null) return
      const to = defaults[key]
      setBusy(key)
      setFailed(null)
      const own = Object.fromEntries(
        projects.flatMap((project, at) => {
          const view = rules[at]?.data
          return view === undefined || valueIn(view, key) === to ? [] : [[project.id, view] as const]
        }),
      )
      Promise.all(Object.keys(own).map((projectId) => client.setProjectRules({ projectId, [key]: to }))).then(
        () => {
          setBusy(null)
          for (const projectId of Object.keys(own)) void cache.invalidateQueries({ queryKey: keys.rules(projectId), exact: true })
        },
        (failure: unknown) => {
          setBusy(null)
          setFailed(messageOf(failure))
          for (const projectId of Object.keys(own)) void cache.invalidateQueries({ queryKey: keys.rules(projectId), exact: true })
        },
      )
    },
    [cache, client, defaults, projects, rules],
  )

  return { differing, inEveryProject, busy, failed }
}
