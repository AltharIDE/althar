// Scrappy: D · a launcher. ⌘R runs the default, as the button does; ⇧⌘R opens the app's own finder over everything to run and every script; the list is kept in the project's settings.
import { useEffect, useState } from 'react'

import { FoundState } from '../../../src/foundations/vocabulary'
import { Finder, type FoundPart, type FoundRow } from '../../../src/chrome/Finder/Finder'
import { Button } from '../../../src/primitives/Button/Button'
import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { addressOf } from '../../../../../apps/desktop/src/renderer/shared/running'
import { css, isLive, label, sourceText, useDialogs, useRuns, whereOf } from '../parts'
import { SCRIPTS } from '../scripts'
import { proto } from '../state'

/** The words, with what was typed marked where it falls. */
const marked = (words: string, query: string): FoundPart[] => {
  const q = query.trim().toLowerCase()
  if (q === '') return [{ text: words, hit: false }]
  const parts: FoundPart[] = []
  let from = 0
  const lower = words.toLowerCase()
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, from)) {
    if (at > from) parts.push({ text: words.slice(from, at), hit: false })
    parts.push({ text: words.slice(at, at + q.length), hit: true })
    from = at + q.length
  }
  if (from < words.length) parts.push({ text: words.slice(from), hit: false })
  return parts
}

/** Every word typed somewhere in it, or each letter typed, in order, in its name: sb finds Storybook, e2e the end-to-end tests. */
const fuzzy = (name: string, words: string, query: string) => {
  const typed = query.trim().toLowerCase()
  if (typed.split(/\s+/).every((word) => words.toLowerCase().includes(word))) return true
  const q = typed.replace(/\s+/g, '')
  let at = 0
  for (const ch of name.toLowerCase()) if (ch === q[at]) at += 1
  return at >= q.length
}

export function D() {
  const r = useRuns()
  const dialogs = useDialogs(false)
  const task = r.screen.place === 'task'
  const [finding, setFinding] = useState(r.opening === 'palette' || r.opening === 'search')
  const [query, setQuery] = useState(r.opening === 'search' ? 'story' : '')
  const def = r.def
  const defRun = def === null ? null : r.runOf(def)

  // ⌘R runs the default, as Xcode's does; ⇧⌘R opens the launcher. On the task, from its bar; on the project, from its front.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      if (event.shiftKey || def === null) setFinding(true)
      else r.start(def)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const kept = new Set(r.runnables.map((one) => one.command))
  const rows: Array<FoundRow & { act: () => void; words: string; name: string }> = [
    // What runs here first, to stop; then what is kept, the default first; then the repository's other scripts; then the coordinator.
    ...r.runnables
      .filter((one) => isLive(r.runOf(one)))
      .map((one) => {
        const run = r.runOf(one)!
        return {
          id: `stop-${one.id}`,
          title: `Stop ${label(one)}`,
          state: FoundState.Running,
          ...(run.url === null ? {} : { pullRequest: addressOf(run.url) }),
          matched: marked(`${one.command} · ${whereOf(one, r.screen)}`, query),
          act: () => proto.stop(run.id),
          words: `${label(one)} ${one.command}`,
          name: label(one),
        }
      }),
    ...[...(def === null ? [] : [def]), ...r.runnables.filter((one) => one.id !== def?.id)]
      .filter((one) => !isLive(r.runOf(one)))
      .map((one) => {
        const run = r.runOf(one)
        return {
          id: `run-${one.id}`,
          title: one.id === def?.id ? `Run ${label(one)} · default` : `Run ${label(one)}`,
          state:
            run?.state === 'failed'
              ? FoundState.Yours
              : run?.state === 'ended'
                ? FoundState.Done
                : run?.state === 'stopped'
                  ? FoundState.Stopped
                  : FoundState.Planned,
          matched: marked(`${one.command} · ${whereOf(one, r.screen)} · ${sourceText[one.source]}`, query),
          act: () => r.start(one),
          words: `${label(one)} ${one.command}`,
          name: label(one),
        }
      }),
    ...SCRIPTS.filter((one) => !kept.has(one.command)).map((one) => ({
      id: `script-${one.id}`,
      title: `Run ${one.command}`,
      state: FoundState.Merged,
      matched: marked(one.body, query),
      act: () => {
        const id = proto.add({
          name: undefined,
          command: one.command,
          where: 'here',
          source: 'person',
          script: `${one.pkg} · ${one.name}`,
          goes: { kind: 'finishes' },
        })
        proto.run(id, task ? 'task' : 'main')
      },
      words: `${one.command} ${one.body}`,
      name: one.name,
    })),
    {
      id: 'ask',
      title: query.trim() === '' ? 'Ask the coordinator what else runs' : `Ask the coordinator how to run “${query.trim()}”`,
      state: FoundState.Abandoned,
      act: () => dialogs.add('ask'),
      words: query,
      name: '',
    },
  ]
    .filter((row) => row.id === 'ask' || query.trim() === '' || fuzzy(row.name, row.words, query))
    // With nothing kept yet, the coordinator comes first.
    .sort((a, b) => (def === null ? Number(b.id === 'ask') - Number(a.id === 'ask') : 0))

  const launcher = finding && (
    <Finder
      results={rows.map(({ act: _act, words: _words, name: _name, ...row }) => row)}
      query={query}
      onQueryChange={setQuery}
      onOpen={(id) => {
        setFinding(false)
        rows.find((row) => row.id === id)?.act()
      }}
      onClose={() => setFinding(false)}
      text={{
        title: 'Run something',
        search: task ? 'Run something in this task' : 'Run something in althar',
        results: 'What runs',
        recent: task ? 'In this task’s worktree, unless it always runs on main' : 'On main',
        none: (words) => `Nothing runs “${words}”`,
        count: (n) => (n === 1 ? '1 thing to run' : `${n} things to run`),
        state: {
          [FoundState.Running]: 'Running',
          [FoundState.Planned]: 'Kept',
          [FoundState.Yours]: 'Failed',
          [FoundState.Done]: 'Finished',
          [FoundState.Stopped]: 'Stopped',
          [FoundState.Merged]: 'In package.json',
          [FoundState.Abandoned]: 'Coordinator',
          [FoundState.Ready]: '',
          [FoundState.Kept]: '',
        },
        open: 'run',
      }}
    />
  )

  return (
    <>
      {def === null ? (
        <Button size="small" variant="quiet" icon="terminal" kbd="⇧⌘R" onClick={() => setFinding(true)}>
          Run…
        </Button>
      ) : isLive(defRun) ? (
        <Button size="small" variant="quiet" busy={defRun.state === 'starting'} onClick={() => r.open(defRun)}>
          <span className={css.inline}>
            <LiveDot />
            {defRun.url === null ? label(def) : `${label(def)} · ${addressOf(defRun.url)}`}
          </span>
        </Button>
      ) : (
        <Button size="small" variant="quiet" icon="terminal" kbd="⌘R" onClick={() => r.start(def)}>
          {`Run ${label(def)}`}
        </Button>
      )}
      {def !== null && (
        <IconButton icon="search" size="small" label="Run something else" kbd="⇧⌘R" tooltip="below" onClick={() => setFinding(true)} />
      )}
      {launcher}
      {dialogs.node}
    </>
  )
}
