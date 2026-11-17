import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { HomeProject } from '../../../homes'
import { useMerging } from '../../data/merges'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { yoursByProject } from '../board/lanes'

/*
 * The projects this window reads on its home, told to main as they change,
 * so Manage homes in every window draws each home by what's on it: each
 * project's mark, whether work runs there, and what waits on the person, as
 * the tabs count them. Read from the window's cache, as the tabs read them.
 */
export function HomeReport() {
  const { client, host } = useServices()
  const projects = useQuery(reads(client).projects()).data?.projects ?? null
  const home = useQuery({ ...reads(client).home(), enabled: projects !== null && projects.length > 0 }).data ?? null
  const { merging } = useMerging(home?.tasks ?? null)
  const yours = useMemo(() => (home === null ? new Map<string, number>() : yoursByProject(home, merging)), [home, merging])
  const report = useMemo((): ReadonlyArray<HomeProject> | null => {
    if (projects === null) return null
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      ink: project.ink,
      working: project.working,
      yours: yours.get(project.id) ?? 0,
    }))
  }, [projects, yours])
  const said = report === null ? null : JSON.stringify(report)
  useEffect(() => {
    if (said !== null) host.homes?.report(JSON.parse(said) as ReadonlyArray<HomeProject>)
  }, [host.homes, said])
  return null
}
