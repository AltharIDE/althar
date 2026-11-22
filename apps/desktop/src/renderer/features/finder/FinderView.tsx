import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Room } from '@althar/ui'
import { socketCanCall, type FinderQuery, type SearchDocument } from '@althar/contracts'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { draftKey, setDraftText } from '../../shared/drafts'
import { useEditorList } from '../../shared/OpenIn'
import { usePreferences } from '../../shared/usePreferences'
import { useNewTab } from '../tabs/TabsFrame'
import { showHomes } from '../homes/useHomes'
import { isSection } from '../settings/sections'
import { isProjectSection } from '../projectSettings/sections'
import type { Place } from '../../shared/dictation/Loose'
import { pressDictationShortcut } from '../../shared/dictation/useDictation'
import { catalogKey, catalogRead } from './catalog'
import { entriesFor, withTaskActions } from './entries'
import { OneBox } from './OneBox'
import { revealSearch } from './revealSearch'
import type { Context, Entry, Go, Use } from './model'

const EMPTY_PROJECTS: ReadonlyArray<import('@althar/contracts').ProjectSummary> = []
const EMPTY_DOCUMENTS: ReadonlyArray<import('@althar/contracts').SearchDocument> = []
const USES = 'althar.search.uses'
const remoteAction = (go: Go) => {
  switch (go.to) {
    case 'allow':
      return socketCanCall('Answer')
    case 'merge':
      return socketCanCall('Merge')
    case 'file':
      return socketCanCall('OpenCode')
    default:
      return true
  }
}
const readUses = (): Readonly<Record<string, Use>> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(USES) ?? '{}')
    if (typeof value !== 'object' || value === null) return {}
    return Object.fromEntries(
      Object.entries(value).filter((pair): pair is [string, Use] => {
        const one = pair[1] as Partial<Use> | null
        return (
          one !== null &&
          typeof one === 'object' &&
          typeof one.n === 'number' &&
          Number.isFinite(one.n) &&
          one.n > 0 &&
          typeof one.at === 'number' &&
          Number.isFinite(one.at)
        )
      }),
    )
  } catch {
    return {}
  }
}

/**
 * `place`: the box chooses where something goes rather than where the person does: a project, for its coordinator, or a
 * task, an aside among them, and nothing else shows.
 */
export function FinderView({
  projectId,
  onClose,
  onUsage,
  place,
}: {
  projectId: string | null
  onClose: () => void
  onUsage?: () => void
  place?: (to: Place) => void
}) {
  const { client, cache, feed, host } = useServices()
  const remote = client.connection !== undefined
  const navigate = useNavigate()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const thread = path.startsWith('/threads/') ? path.slice('/threads/'.length) : null
  const projects = useQuery(reads(client).projects()).data?.projects ?? EMPTY_PROJECTS
  const [search, setSearch] = useState<FinderQuery>({ text: '' })
  const readsDocuments = search.kinds?.length !== 0
  const catalog = useQuery(catalogRead(client, search, readsDocuments))
  const documents = catalog.data?.documents ?? EMPTY_DOCUMENTS
  const [drilled, setDrilled] = useState<string | null>(thread)
  const actionRead = useQuery({ ...reads(client).thread(drilled ?? ''), enabled: drilled !== null })
  const current = useQuery({ ...reads(client).thread(thread ?? ''), enabled: thread !== null }).data
  const currentTask = current?.task.id ?? null
  const usage = useMemo(() => readUses(), [])
  const context: Context = useMemo(
    () => ({ project: projectId, task: currentTask, projects, usage }),
    [projectId, currentTask, projects, usage],
  )
  const fileThread = thread ?? projects.find((one) => one.id === projectId)?.coordinatorThreadId ?? null
  const files = useQuery({
    queryKey: ['searchFiles', fileThread],
    queryFn: () => client.getSearchFiles(fileThread!),
    enabled: fileThread !== null,
    staleTime: 30_000,
  })
  const entries = useMemo(() => {
    const task = current?.task
    const projected: ReadonlyArray<SearchDocument> =
      current === undefined || task === undefined || documents.some((one) => one.id === `task:${task.id}`)
        ? documents
        : [
            ...documents,
            {
              id: `task:${task.id}`,
              kind: 'task',
              projectId: current.project.id,
              threadId: current.threadId,
              taskId: task.id,
              itemId: null,
              title: task.title,
              body: task.request ?? task.description,
              ref: task.slug,
              url: null,
              changedAt: '1970-01-01T00:00:00.000Z',
              state: task.phase ?? task.state,
            },
          ]
    return entriesFor(projected, projects, context, files.data?.files ?? [], fileThread)
  }, [documents, current, projects, context, files.data, fileThread])
  const hydrated = useMemo(() => {
    // Dictate is there where this window can dictate.
    const available = withTaskActions(entries, actionRead.data).filter(
      (one) => one.id !== 'command:dictate' || host.dictation !== undefined,
    )
    const all = remote
      ? available
          .filter((one) => remoteAction(one.go))
          .map((one) => (one.acts === undefined ? one : { ...one, acts: one.acts.filter((act) => remoteAction(act.go)) }))
      : available
    if (place === undefined) return all
    return all
      .filter((one) => one.kind === 'task' || one.id.startsWith('project:'))
      .map((one) => ({ ...one, acts: one.acts?.filter((act) => act.id === 'open').map((act) => ({ ...act, title: 'Place it here' })) }))
  }, [entries, actionRead.data, place, host.dictation, remote])
  const editors = useEditorList(!remote)
  const { preferences } = usePreferences()
  const newTab = useNewTab()
  const [error, setError] = useState<string | null>(null)
  // Coalesce feed updates while a query is open, without starving it when
  // messages stream continuously. Closed windows do no search work.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unlisten = feed.listen((event) => {
      if (
        event._tag !== 'Changed' ||
        timer !== undefined ||
        !['project', 'task', 'thread_item', 'user_input', 'project_note', 'external_link', 'run', 'card'].includes(event.aggregateType)
      )
        return
      timer = setTimeout(() => {
        timer = undefined
        void cache.invalidateQueries({ queryKey: catalogKey }, { cancelRefetch: false })
      }, 1000)
    })
    return () => {
      clearTimeout(timer)
      unlisten()
    }
  }, [feed, cache])
  const run = (go: Go, entry?: Entry) => {
    if (place !== undefined) {
      if (go.to === 'task' && go.slug !== '') place({ kind: 'task', threadId: go.slug })
      else if (go.to === 'project') place({ kind: 'coordinator', projectId: go.project })
      return
    }
    if (entry !== undefined) {
      const used = readUses()
      const next = { ...used, [entry.id]: { at: Date.now(), n: (used[entry.id]?.n ?? 0) + 1 } }
      const kept = Object.fromEntries(
        Object.entries(next)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, 200),
      )
      try {
        localStorage.setItem(USES, JSON.stringify(kept))
      } catch {
        /* Usage is optional. */
      }
    }
    // The box closes immediately; action failures are shown by a persistent
    // window notice, with Retry, instead of disappearing with the palette.
    void perform(go).catch((reason: unknown) => {
      window.dispatchEvent(
        new CustomEvent('althar-search-error', {
          detail: { message: reason instanceof Error ? reason.message : String(reason), retry: () => run(go, entry) },
        }),
      )
    })
  }
  const perform = async (go: Go) => {
    switch (go.to) {
      case 'home':
        await navigate({ to: '/' })
        return
      case 'task':
        if (go.at !== undefined) revealSearch(go.slug, go.at)
        await navigate({ to: '/threads/$threadId', params: { threadId: go.slug } })
        return
      case 'project':
        if (go.at !== undefined && go.threadId !== undefined) revealSearch(go.threadId, go.at)
        await navigate({
          to: '/projects/$projectId',
          params: { projectId: go.project },
          search: {
            ...(Object.values(Room).includes(go.room as Room) ? { room: go.room as Room } : {}),
            ...(isProjectSection(go.section) ? { section: go.section } : {}),
          },
        })
        return
      case 'settings':
        await navigate({ to: '/settings/$section', params: { section: isSection(go.section) ? go.section : 'agents' } })
        return
      case 'ask':
        if (go.project === '') throw new Error('Open a project to ask its coordinator.')
        setDraftText(draftKey.coordinator(go.project), (was) => (was === '' ? go.text : `${was}\n\n${go.text}`))
        await navigate({ to: '/projects/$projectId', params: { projectId: go.project }, search: { room: Room.Talk } })
        return
      case 'external':
        if (/^https?:\/\//.test(go.url)) window.open(go.url, '_blank')
        return
      case 'allow':
        await client.answer({ attentionId: go.attentionId, decision: 'allow' })
        return
      case 'merge':
        await client.merge(go.taskId, go.head, go.url)
        return
      case 'copy':
        await navigator.clipboard.writeText(go.text)
        return
      case 'file': {
        const editor = editors.find((one) => one.id === preferences.editor) ?? editors[0]
        if (editor === undefined) {
          await navigate({ to: '/settings/$section', params: { section: 'editor-and-browser' } })
          return
        }
        if (!(await client.openCode({ threadId: go.threadId, path: go.path, editor: editor.id })))
          throw new Error('The file could not be opened. Check your editor in Settings.')
        return
      }
      case 'command':
        if (go.command === 'new-project') {
          if (remote) showHomes()
          else newTab.start()
        } else if (go.command === 'usage') onUsage?.()
        else if (go.command === 'dictate') pressDictationShortcut()
        else if (go.command === 'stop' && go.taskId !== undefined) await client.stopTask(go.taskId)
        else if (go.command === 'resume' && go.taskId !== undefined) await client.resumeTask({ taskId: go.taskId })
    }
  }
  return (
    <OneBox
      context={context}
      placing={place !== undefined}
      entries={hydrated}
      onSearch={setSearch}
      searching={readsDocuments && catalog.isPending}
      onDrill={(entry) => {
        if (entry.go.to === 'task') setDrilled(entry.go.slug)
      }}
      onClose={onClose}
      run={run}
      status={
        catalog.isError || files.isError || error !== null ? (
          <p role="status">
            {error ?? (catalog.isError ? 'Search could not refresh.' : 'File names could not be read.')}{' '}
            <button
              type="button"
              onClick={() => {
                setError(null)
                void catalog.refetch()
                void files.refetch()
              }}
            >
              Try again
            </button>
          </p>
        ) : readsDocuments && (catalog.isPending || catalog.data?.indexing === true) ? (
          <p role="status">{catalog.isPending ? 'Reading your projects…' : 'Indexing conversation history…'}</p>
        ) : undefined
      }
    />
  )
}
