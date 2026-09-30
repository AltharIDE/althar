import { useCallback, useEffect, useState } from 'react'

import type { AgentStatus, ProjectSummary, TaskSummary } from '@charrette/contracts'

import { messageOf } from '../../data/client'
import { useServices, useWatch } from '../../data/services'

/*
 * A project's view model: its tasks, the agents that could lead a new one,
 * and starting a task: its worktree, then its lead, from its brief.
 */

export interface NewTask {
  readonly title: string
  readonly description: string
  readonly agentId: string
}

export interface ProjectModel {
  readonly project: ProjectSummary | null
  readonly tasks: ReadonlyArray<TaskSummary> | null
  /** Agents that could lead a task: those signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  readonly starting: boolean
  /** Creates the task and starts its lead; the task, or null when it couldn't. */
  readonly startTask: (input: NewTask) => Promise<TaskSummary | null>
}

/** Changes that move what a project's screen shows: its name, its tasks, their branches, who is working, what waits on you. */
const SHOWN = new Set(['project', 'task', 'workspace', 'provider_session', 'attention_request'])

export const useProject = (projectId: string): ProjectModel => {
  const { client } = useServices()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [tasks, setTasks] = useState<ReadonlyArray<TaskSummary> | null>(null)
  const [since, setSince] = useState<number | null>(null)
  const [agents, setAgents] = useState<ReadonlyArray<AgentStatus>>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const load = useCallback(() => {
    Promise.all([client.listProjects(), client.listTasks(projectId)]).then(
      ([projects, list]) => {
        setProject(projects.projects.find((candidate) => candidate.id === projectId) ?? null)
        setTasks(list.tasks)
        // Watching from the earlier of the two reads misses nothing either saw.
        setSince((first) => first ?? Math.min(projects.cursor, list.cursor))
      },
      (failure: unknown) => setError(messageOf(failure)),
    )
  }, [client, projectId])

  useEffect(() => {
    load()
    client.status().then(
      (status) => setAgents(status.agents.filter((agent) => agent.signIn !== 'signed_out')),
      (failure: unknown) => setError(messageOf(failure)),
    )
  }, [client, load])

  useWatch((event) => {
    if (event._tag === 'Changed' && event.projectId === projectId && SHOWN.has(event.aggregateType)) load()
  }, since)

  const startTask = useCallback(
    async (input: NewTask) => {
      setError(null)
      setStarting(true)
      try {
        const task = await client.createTask({
          projectId,
          title: input.title.trim(),
          ...(input.description.trim() === '' ? {} : { description: input.description.trim() }),
        })
        await client.startSession({ threadId: task.threadId, agentId: input.agentId })
        return task
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setStarting(false)
      }
    },
    [client, projectId],
  )

  return { project, tasks, agents, error, starting, startTask }
}
