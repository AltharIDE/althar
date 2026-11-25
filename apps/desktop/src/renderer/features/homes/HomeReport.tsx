import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { HomeProject, HomeProjectRemote } from '../../../homes'
import { useMerging } from '../../data/merges'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { yoursByProject } from '../board/lanes'

/*
 * The projects this window reads on its home, told to main as they change,
 * so Manage homes in every window draws each home by what's on it: each
 * project's mark, whether work runs there, and what waits on the person, as
 * the tabs count them. Read from the window's cache, as the tabs read them.
 * This computer's own window says where each project's code is on its code
 * host too, so a window on another computer's home can clone it there.
 */
export function HomeReport() {
  const { client, host } = useServices()
  const projects = useQuery(reads(client).projects()).data?.projects ?? null
  const home = useQuery({ ...reads(client).home(), enabled: projects !== null && projects.length > 0 }).data ?? null
  const { merging } = useMerging(home?.tasks ?? null)
  const yours = useMemo(() => (home === null ? new Map<string, number>() : yoursByProject(home, merging)), [home, merging])
  // Only this computer's projects: another home's are cloned there already.
  const local = client.connection === undefined && host.homes !== undefined
  const repositories = useQueries({
    queries: (local ? (projects ?? []) : []).map((project) => ({ ...reads(client).repositories(project.id), staleTime: 60_000 })),
  })
  const remotes = repositories.map((read): ReadonlyArray<HomeProjectRemote> =>
    (read.data ?? []).flatMap((one) =>
      one.host?.url == null || !one.host.url.startsWith('https://') ? [] : [{ url: one.host.url, product: one.host.product }],
    ),
  )
  const said = remotes.map((one) => JSON.stringify(one)).join('\n')
  const report = useMemo((): ReadonlyArray<HomeProject> | null => {
    if (projects === null) return null
    const of = said === '' ? [] : said.split('\n').map((one) => JSON.parse(one) as ReadonlyArray<HomeProjectRemote>)
    return projects.map((project, at) => {
      const mine = of[at] ?? []
      return {
        id: project.id,
        name: project.name,
        ink: project.ink,
        working: project.working,
        yours: yours.get(project.id) ?? 0,
        ...(local && mine.length > 0 ? { remotes: mine.slice(0, 8) } : {}),
      }
    })
  }, [projects, yours, local, said])
  const told = report === null ? null : JSON.stringify(report)
  useEffect(() => {
    if (told !== null) host.homes?.report(JSON.parse(told) as ReadonlyArray<HomeProject>)
  }, [host.homes, told])
  return null
}
