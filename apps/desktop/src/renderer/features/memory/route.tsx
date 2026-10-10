import { createRoute, useNavigate } from '@tanstack/react-router'

import { Room } from '@althar/ui'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { MemoryView } from './MemoryView'
import { useMemory } from './useMemory'

function MemoryScreen({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  return (
    <MemoryView
      model={useMemory(projectId)}
      onBack={() => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      onSource={(entry) =>
        void (entry.taskId === null
          ? navigate({ to: '/projects/$projectId', params: { projectId }, search: { room: Room.Talk } })
          : navigate({ to: '/threads/$threadId', params: { threadId: entry.threadId } }))
      }
    />
  )
}
function Memory() {
  const { projectId } = memoryRoute.useParams()
  return <MemoryScreen key={projectId} projectId={projectId} />
}
export const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/memory',
  component: Memory,
  pendingComponent: PagePending,
  loader: ({ context: { client, cache }, params: { projectId } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.memory(projectId, '', false, 0)), cache.fetchQuery(read.projects()))
  },
})
