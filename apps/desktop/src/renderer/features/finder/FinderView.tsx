import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Room } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { draftKey, setDraftText } from '../../shared/drafts'
import { useEditorList } from '../../shared/OpenIn'
import { usePreferences } from '../../shared/usePreferences'
import { useNewTab } from '../tabs/TabsFrame'
import { isSection } from '../settings/sections'
import { isProjectSection } from '../projectSettings/sections'
import { catalogKey, catalogRead } from './catalog'
import { entriesFor, withTaskActions } from './entries'
import { OneBox } from './OneBox'
import { revealSearch } from './revealSearch'
import type { Context, Entry, Go, Use } from './model'

const EMPTY_PROJECTS: ReadonlyArray<import('@althar/contracts').ProjectSummary> = []
const EMPTY_DOCUMENTS: ReadonlyArray<import('@althar/contracts').SearchDocument> = []
const USES = 'althar.search.uses'
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

/** Warm once with the window, before the first key. No index data is stored
 * in browser storage: only ids and usage counts. Removed projects leave on refresh. */
export const useWarmSearch = () => {
  const { client, cache, feed } = useServices()
  useEffect(() => {
    void cache.prefetchQuery(catalogRead(client))
    return feed.listen((event) => {
      if (
        event._tag === 'Changed' &&
        ['project', 'task', 'thread_item', 'user_input', 'project_note', 'external_link', 'run', 'card'].includes(event.aggregateType)
      ) {
        void cache.invalidateQueries({ queryKey: catalogKey, refetchType: 'none' })
      }
    })
  }, [client, cache, feed])
}

export function FinderView({ projectId, onClose, onUsage }: { projectId: string | null; onClose: () => void; onUsage?: () => void }) {
  const { client, cache, feed } = useServices()
  const navigate = useNavigate()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const thread = path.startsWith('/threads/') ? path.slice('/threads/'.length) : null
  const projects = useQuery(reads(client).projects()).data?.projects ?? EMPTY_PROJECTS
  const catalog = useQuery(catalogRead(client))
  const documents = catalog.data ?? EMPTY_DOCUMENTS
  const currentTask = documents.find((one) => one.kind === 'task' && one.threadId === thread)
  const usage = useMemo(() => readUses(), [])
  const context: Context = useMemo(
    () => ({ project: projectId, task: currentTask?.taskId ?? null, projects, usage }),
    [projectId, currentTask?.taskId, projects, usage],
  )
  const fileThread = thread ?? projects.find((one) => one.id === projectId)?.coordinatorThreadId ?? null
  const files = useQuery({
    queryKey: ['searchFiles', fileThread],
    queryFn: () => client.getSearchFiles(fileThread!),
    enabled: fileThread !== null,
    staleTime: 30_000,
  })
  const entries = useMemo(
    () => entriesFor(documents, projects, context, files.data?.files ?? [], fileThread),
    [documents, projects, context, files.data, fileThread],
  )
  const [drilled, setDrilled] = useState<string | null>(thread)
  const actionRead = useQuery({ ...reads(client).thread(drilled ?? ''), enabled: drilled !== null })
  const hydrated = useMemo(() => withTaskActions(entries, actionRead.data), [entries, actionRead.data])
  const editors = useEditorList()
  const { preferences } = usePreferences()
  const newTab = useNewTab()
  const [error, setError] = useState<string | null>(null)
  // A burst (streamed text) refreshes once it rests, keeping the last whole
  // collection and the typed words while a replacement comes together.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unlisten = feed.listen((event) => {
      if (event._tag !== 'Changed') return
      clearTimeout(timer)
      timer = setTimeout(() => void cache.invalidateQueries({ queryKey: catalogKey }), 1000)
    })
    return () => {
      clearTimeout(timer)
      unlisten()
    }
  }, [feed, cache])
  const run = (go: Go, entry?: Entry) => {
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
        if (go.command === 'new-project') newTab.start()
        else if (go.command === 'usage') onUsage?.()
        else if (go.command === 'stop' && go.taskId !== undefined) await client.stopTask(go.taskId)
        else if (go.command === 'resume' && go.taskId !== undefined) await client.resumeTask({ taskId: go.taskId })
    }
  }
  return (
    <OneBox
      context={context}
      entries={hydrated}
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
        ) : catalog.isPending ? (
          <p role="status">Reading your projects…</p>
        ) : undefined
      }
    />
  )
}
