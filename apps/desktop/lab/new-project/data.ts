import type { Client } from '../../src/renderer/data/client'
import { connectionList, coordinatorSnapshot, fakeClient, githubConnection, home, repositories, snapshot } from '../../tests/fixtures'
import { world } from './world'

/*
 * The lab's runtime, the home's: its projects, each project's board (empty,
 * as a new one's is) and its coordinator's conversation as it grows, read
 * from the world each time, so a screen read again shows what changed.
 */

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: Date.now(), projects: [...world.projects()] }),
    openProject: async (projectId) => world.project(projectId) ?? world.projects()[0]!,
    getHome: async () => home({ projects: [...world.projects()], tasks: [], calls: [], events: [] }),
    getBoard: async (projectId) => world.board(projectId),
    getCoordinator: async (projectId) => {
      const project = world.project(projectId)
      const running = world.working(projectId)
      const base = snapshot()
      return coordinatorSnapshot({
        threadId: `thc_${projectId}`,
        cursor: Date.now(),
        project: { id: projectId, name: project?.name ?? '' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: [...world.said(projectId)],
        session: running
          ? {
              ...(base.session as NonNullable<typeof base.session>),
              turnRunning: true,
              turnStartedAt: new Date(Date.now() - 4000).toISOString(),
            }
          : null,
      })
    },
    getRepositories: async (projectId) => {
      const project = world.project(projectId)
      const [first] = repositories
      if (project === undefined || first === undefined) return []
      return [
        { ...first, id: `repo_${projectId}`, name: project.repositories[0] ?? project.name, path: project.repository ?? '', setup: null },
      ]
    },
    listConnections: async () => ({
      ...connectionList,
      connections: [{ ...githubConnection, account: { login: 'balazs', name: 'Balázs' } }],
    }),
  }).client
