import { useQuery } from '@tanstack/react-query'

import { useServices } from '../data/services'
import { ago } from './time'

/*
 * The repositories main found where people keep code, read once a window:
 * the first screen offers them, and so does a new project. Each is known by
 * main's id and where it is, never by its path.
 */

/** The repositories found, read once a window. */
export const foundKey = ['found-repositories'] as const

export const useFound = () => {
  const { host } = useServices()
  return useQuery({ queryKey: foundKey, queryFn: () => host.findRepositories(), staleTime: Infinity })
}

/** What else says which one it is: its branch, and when it was last worked on. */
export const factsOf = (branch: string | null, worked: number, now: Date) =>
  [branch, worked > 0 ? ago(new Date(worked).toISOString(), now) : null].filter((part) => part !== null).join(' · ')
