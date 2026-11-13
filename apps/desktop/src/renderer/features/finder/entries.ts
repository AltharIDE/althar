import type { ProjectSummary, SearchDocument, ThreadSnapshot } from '@althar/contracts'
import { modKey, Room } from '@althar/ui'
import { sectionText } from '../settings/sections'
import type { Context, Entry, Act, Go, Stand } from './model'

const STANDS: Readonly<Record<string, Stand>> = {
  running: { word: 'Running', tone: 'live' },
  waiting: { word: 'Needs you', tone: 'signal' },
  ready: { word: 'Ready', tone: 'signal' },
  planned: { word: 'Planned', tone: 'quiet' },
  held: { word: 'Held', tone: 'quiet' },
  stopped: { word: 'Stopped', tone: 'quiet' },
  kept: { word: 'Kept for later', tone: 'quiet' },
  done: { word: 'Done', tone: 'quiet' },
  abandoned: { word: 'Abandoned', tone: 'quiet' },
  open: { word: 'Open', tone: 'quiet' },
}

/** Stable identities for opening, folding a linked item into its task, and usage. */
const documentEntry = (doc: SearchDocument, projects: ReadonlyArray<ProjectSummary>): Entry => {
  const project = projects.find((one) => one.id === doc.projectId)
  const go: Go =
    doc.kind === 'note'
      ? { to: 'project', project: doc.projectId, room: Room.Settings, section: 'notes' }
      : doc.kind === 'conversation' || doc.taskId === null
        ? {
            to: 'project',
            project: doc.projectId,
            room: Room.Talk,
            ...(doc.itemId === null || doc.threadId === null ? {} : { at: doc.itemId, threadId: doc.threadId }),
          }
        : { to: 'task', slug: doc.threadId ?? '', ...(doc.itemId === null ? {} : { at: doc.itemId }) }
  const acts: Array<Act> = [{ id: 'open', title: doc.kind === 'said' ? 'Open the thread here' : 'Open', icon: 'arrow', go }]
  if (doc.url !== null) acts.push({ id: 'host', title: 'Open on its host', icon: 'external', go: { to: 'external', url: doc.url } })
  acts.push({ id: 'copy', title: 'Copy', icon: 'copy', go: { to: 'copy', text: doc.url ?? (doc.kind === 'task' ? doc.ref : doc.title) } })
  if (doc.kind === 'task' && doc.state === 'running')
    acts.push({ id: 'stop', title: 'Stop task', icon: 'stop', danger: true, go: { to: 'command', command: 'stop', taskId: doc.taskId! } })
  if (doc.kind === 'task' && doc.state === 'stopped')
    acts.push({ id: 'resume', title: 'Resume task', icon: 'play', go: { to: 'command', command: 'resume', taskId: doc.taskId! } })
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    icon:
      doc.kind === 'task'
        ? 'work'
        : doc.kind === 'pull'
          ? 'pr'
          : doc.kind === 'issue'
            ? 'issues'
            : doc.kind === 'note'
              ? 'quote'
              : 'comment',
    project: doc.projectId,
    projectName: project?.name ?? '',
    place: doc.taskId ?? `conversation:${doc.projectId}`,
    keys: doc.ref === '' ? [] : [doc.ref],
    also: doc.ref,
    facts: doc.kind === 'said' || doc.kind === 'pull' || doc.kind === 'issue' ? [doc.ref] : [],
    ago: Math.max(0, (Date.now() - Date.parse(doc.changedAt)) / 60000),
    ...(STANDS[doc.state] === undefined ? {} : { stand: STANDS[doc.state] }),
    go,
    acts,
  }
}

/** Actions use the same runtime snapshot and ids as the task screen. */
export const withTaskActions = (entries: ReadonlyArray<Entry>, snapshot: ThreadSnapshot | undefined): ReadonlyArray<Entry> => {
  if (snapshot === undefined) return entries
  return entries.map((entry) => {
    if (entry.kind !== 'task' || entry.place !== snapshot.task.id) return entry
    const acts: Act[] = []
    for (const call of snapshot.attention)
      if (call.kind === 'permission')
        acts.push({
          id: `allow:${call.id}`,
          title: `Allow ${call.command ?? call.title}`,
          icon: 'check',
          go: { to: 'allow', attentionId: call.id },
        })
    if (snapshot.task.phase === 'ready' || snapshot.task.mergeable === true)
      for (const change of snapshot.task.changes) {
        if (change.state === 'open' && change.head !== null && change.queued !== true)
          acts.push({
            id: `merge:${change.url}`,
            title: `Merge ${change.prefix}${change.number}`,
            icon: 'after',
            go: { to: 'merge', taskId: snapshot.task.id, head: change.head, url: change.url },
          })
      }
    for (const action of ['stop', 'resume'] as const)
      if (snapshot.task.actions.includes(action))
        acts.push({
          id: action,
          title: action === 'stop' ? 'Stop task' : 'Resume task',
          icon: action === 'stop' ? 'stop' : 'play',
          danger: action === 'stop',
          go: { to: 'command', command: action, taskId: snapshot.task.id },
        })
    return { ...entry, acts: [...acts, ...(entry.acts ?? []).filter((one) => one.id !== 'stop' && one.id !== 'resume')] }
  })
}

export const entriesFor = (
  documents: ReadonlyArray<SearchDocument>,
  projects: ReadonlyArray<ProjectSummary>,
  context: Context,
  files: ReadonlyArray<string>,
  fileThread: string | null,
): ReadonlyArray<Entry> => {
  const docs = documents.map((doc) => documentEntry(doc, projects))
  // Keep one task result for its linked records, searchable by every linked key.
  const linked = new Map<string, SearchDocument[]>()
  for (const doc of documents)
    if ((doc.kind === 'pull' || doc.kind === 'issue') && doc.taskId !== null)
      linked.set(doc.taskId, [...(linked.get(doc.taskId) ?? []), doc])
  const entries = docs.map((entry) =>
    entry.kind !== 'task'
      ? entry
      : {
          ...entry,
          keys: [...(entry.keys ?? []), ...(linked.get(entry.place ?? '') ?? []).map((one) => one.ref)],
          facts: (linked.get(entry.place ?? '') ?? []).map((one) => one.ref),
          also: [entry.also, ...(linked.get(entry.place ?? '') ?? []).map((one) => `${one.ref} ${one.title}`)].join(' '),
        },
  )
  const project = projects.find((one) => one.id === context.project)
  const places: Entry[] = [
    { id: 'place:home', kind: 'place', title: 'Home', icon: 'work', scope: 'app', shortcut: modKey('1'), go: { to: 'home' } },
    ...projects.map((one): Entry => ({
      id: `project:${one.id}`,
      kind: 'place',
      title: one.name,
      icon: 'folder',
      project: one.id,
      projectName: one.name,
      go: { to: 'project', project: one.id },
    })),
    ...Object.entries(sectionText).map(([section, text]): Entry => ({
      id: `settings:${section}`,
      kind: 'place',
      title: text.title,
      icon: text.icon,
      also: 'settings preferences',
      facts: ['Settings'],
      scope: 'app',
      go: { to: 'settings', section },
    })),
    {
      id: 'command:new-project',
      kind: 'action',
      title: 'New project',
      icon: 'plus',
      shortcut: modKey('N'),
      scope: 'app',
      go: { to: 'command', command: 'new-project' },
    },
    {
      id: 'command:usage',
      kind: 'action',
      title: 'Plan usage',
      icon: 'load',
      shortcut: modKey('U'),
      scope: 'app',
      go: { to: 'command', command: 'usage' },
    },
  ]
  if (project !== undefined) {
    for (const [room, title, icon] of [
      [Room.Board, 'Board', 'list'],
      [Room.Talk, 'Conversation', 'comment'],
      [Room.Artifacts, 'Artifacts', 'canvas'],
      [Room.Automations, 'Automations', 'automation'],
      [Room.Settings, 'Project settings', 'gear'],
    ] as const)
      places.push({
        id: `place:${project.id}:${room}`,
        kind: 'place',
        title,
        icon,
        project: project.id,
        projectName: project.name,
        scope: 'project',
        go: { to: 'project', project: project.id, room },
      })
    places.push({
      id: 'command:ask',
      kind: 'action',
      title: 'Ask the coordinator',
      icon: 'comment',
      scope: 'project',
      go: { to: 'ask', project: project.id, text: '' },
    })
  }
  const task = entries.find((one) => one.kind === 'task' && one.place === context.task)
  const taskActions = (task?.acts ?? [])
    .filter((one) => one.id !== 'open' && one.id !== 'copy')
    .map((one): Entry => ({
      ...one,
      id: `action:${task!.id}:${one.id}`,
      kind: 'action',
      scope: 'task',
      project: task!.project,
      projectName: task!.projectName,
    }))
  return [
    ...entries,
    ...places,
    ...taskActions,
    ...(fileThread === null
      ? []
      : files.map((path): Entry => ({
          id: `file:${fileThread}:${path}`,
          kind: 'file',
          title: path.split('/').at(-1) ?? path,
          also: path,
          icon: 'file',
          project: context.project ?? undefined,
          projectName: project?.name,
          facts: [path],
          go: { to: 'file', threadId: fileThread, path },
          acts: [
            { id: 'open', title: 'Open in editor', icon: 'external', go: { to: 'file', threadId: fileThread, path } },
            { id: 'copy', title: 'Copy path', icon: 'copy', go: { to: 'copy', text: path } },
          ],
        }))),
  ]
}
