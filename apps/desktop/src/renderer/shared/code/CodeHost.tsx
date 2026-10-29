import { useQuery } from '@tanstack/react-query'
import { createContext, type KeyboardEvent, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { CodePlace, DiffLine as ApiDiffLine } from '@althar/contracts'
import {
  codeKey,
  type CodeMode,
  CodePanel,
  CodePeek,
  type CodeShell,
  type CodeWhere,
  type DiffLine,
  DiffLineKind,
  firstMode,
  type FoundCode,
  lineToOpen,
  markOf,
  Menu,
  MenuItem,
  SplitButton,
  Button,
} from '@althar/ui'

import { useServices } from '../../data/services'
import { text as openInText, useEditorList } from '../OpenIn'
import { ago } from '../time'
import { usePreferences } from '../usePreferences'
import { CODE_FRESH, codeKeys, foundRead, placeRead } from './finds'

/*
 * The code a thread's agent names, as the thread's screen offers it to the
 * kit (ThreadShell's code): what each name names, found where the agent
 * works; a peek at its lines while it is pointed at; the file beside the
 * thread on a press, in the panel on the conversation's workbench, read as
 * it is now and, for the coordinator's, as it was when said; and in the
 * person's editor, the one Settings says, on ⌘-press or from the panel.
 * ⌥↓ and ⌥↑ step through the thread's names, wherever focus is but where
 * something is typed.
 */

/** The item a message is, around what it says: its names are read as they were when it was said. */
export const SaidIn = createContext<string | null>(null)

/** A file open beside the thread: what it names, the name it was opened from, and whether it went on top of the lead's document. */
export interface CodeOpen {
  readonly found: FoundCode
  readonly from: HTMLElement | null
  readonly onTop: boolean
}

/** Where a file was read from, for the words that say it: its repository's branch, and when the message was said. */
export const whereOf = (place: CodePlace | undefined, found: FoundCode): CodeWhere | undefined => {
  if (place === undefined) return undefined
  const path = found.kind === 'several' ? '' : found.path
  const repository =
    place.repositories.length > 1 ? place.repositories.find((one) => path.startsWith(`${one.slug}/`)) : place.repositories[0]
  const said = found.kind === 'file' && found.since !== null ? ago(found.since.said) : undefined
  return { kind: place.kind, branch: repository?.branch ?? '', ...(said === undefined ? {} : { said }) }
}

/** The editors here, the one files open in, and opening a thread's file in one, which then becomes the one. */
export const useCodeEditors = (threadId: string) => {
  const { client } = useServices()
  const { preferences, set } = usePreferences()
  const editors = useEditorList()
  const main = editors.find((editor) => editor.id === preferences.editor) ?? editors[0]
  const open = (editor: string, found: FoundCode) => {
    if (found.kind === 'several') return
    if (editor !== preferences.editor) set('editor', editor)
    const line = found.kind === 'file' ? lineToOpen(found) : undefined
    void client.openCode({ threadId, editor, path: found.path, ...(line === undefined ? {} : { line }) })
  }
  return { editors, main, open }
}

/** A file's lines, in a way it is shown: undefined while read, null where they couldn't be; nothing to read for what isn't text. */
const useCodeRead = (threadId: string, found: FoundCode, mode: CodeMode, fresh: boolean) => {
  const { client } = useServices()
  const file = found.kind === 'file' && found.content === 'text' ? found : null
  const commit = file !== null && mode === 'then' ? (file.since?.commit ?? null) : null
  // Around the lines marked in the way it is shown: as they were, read as it was; else where they are now.
  const line = file === null ? null : (markOf(file, mode)?.line ?? lineToOpen(file) ?? file.line ?? null)
  const read = useQuery({
    queryKey: codeKeys.text(threadId, file?.path ?? '', commit, line),
    queryFn: () =>
      client.readCode(threadId, file?.path ?? '', { ...(commit === null ? {} : { commit }), ...(line === null ? {} : { line }) }),
    enabled: file !== null && mode !== 'change',
    staleTime: CODE_FRESH,
    gcTime: 5 * 60_000,
    // The panel reads the file again as it opens: it shows the file as it is now.
    ...(fresh ? { refetchOnMount: 'always' as const } : {}),
  })
  return read.isError ? null : read.data
}

const KINDS: Readonly<Record<ApiDiffLine['kind'], DiffLineKind>> = {
  hunk: DiffLineKind.Hunk,
  context: DiffLineKind.Context,
  added: DiffLineKind.Added,
  removed: DiffLineKind.Removed,
}

/** What the task changed in a file, for the panel's Change: read as it is asked for, and again each time. */
const useCodeChange = (taskId: string | null, found: FoundCode, on: boolean): readonly DiffLine[] | null | undefined => {
  const { client } = useServices()
  const path = found.kind === 'file' ? found.path : ''
  const read = useQuery({
    queryKey: codeKeys.change(taskId ?? '', path),
    queryFn: async () =>
      (await client.getFileDiff(taskId ?? '', path)).lines.map((line) => ({ ...line, kind: KINDS[line.kind] }) as DiffLine),
    enabled: on && taskId !== null && path !== '',
    refetchOnMount: 'always',
  })
  return read.isError ? null : read.data
}

/** The peek over a name: its lines as it first shows, where they were read from, and the ways on. */
function CodePeekOf({
  found,
  threadId,
  onBeside,
  onGo,
}: {
  found: FoundCode
  threadId: string
  onBeside: (() => void) | undefined
  onGo: (name: string) => void
}) {
  const { client } = useServices()
  const place = useQuery(placeRead(client, threadId)).data
  const read = useCodeRead(threadId, found, firstMode(found), false)
  const { main, open } = useCodeEditors(threadId)
  return (
    <CodePeek
      found={found}
      {...(place === undefined ? {} : { where: whereOf(place, found) })}
      {...(read === undefined ? {} : { read })}
      {...(onBeside === undefined ? {} : { onBeside })}
      onGo={onGo}
      {...(main === undefined || found.kind !== 'file' ? {} : { editor: { name: main.name, onOpen: () => open(main.id, found) } })}
      text={{ inEditor: openInText.in }}
    />
  )
}

/** Open it in the editor files open in, or another from its menu; narrow, the editor's name alone. */
function OpenCodeIn({ found, threadId, compact }: { found: FoundCode; threadId: string; compact: boolean }) {
  const { editors, main, open } = useCodeEditors(threadId)
  if (main === undefined || found.kind === 'several') return null
  const label = compact ? main.name : openInText.in(main.name)
  const others = editors.filter((editor) => editor.id !== main.id)
  if (others.length === 0)
    return (
      <Button size="small" onClick={() => open(main.id, found)}>
        {label}
      </Button>
    )
  return (
    <SplitButton
      size="small"
      onClick={() => open(main.id, found)}
      moreLabel={openInText.more}
      menu={(trigger) => (
        <Menu trigger={trigger} label={openInText.more} align="end">
          {others.map((editor) => (
            <MenuItem key={editor.id} onSelect={() => open(editor.id, found)}>
              {openInText.in(editor.name)}
            </MenuItem>
          ))}
        </Menu>
      )}
    >
      {label}
    </SplitButton>
  )
}

/**
 * The names in the thread that open code, in the order they read: not those in what is open beside it, nor those hidden,
 * as a screen the window keeps while another shows is (`KeptScreens`).
 */
const namesInThread = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[data-code-ref]')].filter(
    (chip) => chip.closest('[data-workbench]') === null && chip.closest('[hidden], [inert], [style*="display: none"]') === null,
  )

/** Where the name a file was opened from is among the thread's: the chip itself while it is there, else the first naming the same. */
const placeAmong = (names: readonly HTMLElement[], open: CodeOpen | null) => {
  if (open === null) return -1
  const at = open.from === null ? -1 : names.indexOf(open.from)
  const key = codeKey(open.found)
  return at >= 0 ? at : names.findIndex((chip) => chip.dataset.codeRef === key)
}

/**
 * The thread's next or last name that names other code than the one open,
 * pressed: it opens beside the thread, as a press on it does. With none
 * open, the first or the last.
 */
const stepFrom = (open: CodeOpen | null, by: -1 | 1) => {
  const names = namesInThread()
  let at = placeAmong(names, open)
  if (at < 0) at = by === 1 ? -1 : names.length
  const key = open === null ? null : codeKey(open.found)
  for (let next = at + by; next >= 0 && next < names.length; next += by) {
    const chip = names[next]
    if (chip === undefined || chip.dataset.codeRef === key) continue
    chip.scrollIntoView?.({ block: 'center' })
    chip.click()
    return
  }
}

/** The panel beside the thread, for the file open: the way it shows it kept per file, its place among the thread's names. */
function CodePanelOf({
  open,
  threadId,
  taskId,
  width,
  onGo,
  onBack,
  onClose,
}: {
  open: CodeOpen
  threadId: string
  taskId: string | null
  /** The workbench's: narrow, the head keeps its room for the file's name. */
  width: number
  onGo: (name: string) => void
  onBack?: () => void
  onClose: () => void
}) {
  const { client } = useServices()
  const { found } = open
  const [kept, setKept] = useState<{ readonly key: string; readonly mode: CodeMode } | null>(null)
  const mode = kept !== null && kept.key === codeKey(found) ? kept.mode : firstMode(found)
  const read = useCodeRead(threadId, found, mode, true)
  const change = useCodeChange(taskId, found, mode === 'change')
  const place = useQuery(placeRead(client, threadId)).data
  const { main, open: inEditor } = useCodeEditors(threadId)
  // Where it is among the thread's names, as the thread is drawn: they are drawn before what they open.
  const names = namesInThread()
  const at = placeAmong(names, open)
  const nav = at < 0 ? null : { at: at + 1, of: names.length }
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || main === undefined || found.kind === 'several') return
    event.preventDefault()
    inEditor(main.id, found)
  }
  return (
    <CodePanel
      found={found}
      {...(place === undefined ? {} : { where: whereOf(place, found) })}
      mode={mode}
      onMode={(next) => setKept({ key: codeKey(found), mode: next })}
      {...(read === undefined ? {} : { read })}
      {...(change === undefined ? {} : { change })}
      actions={<OpenCodeIn found={found} threadId={threadId} compact={width < 400} />}
      {...(nav === null ? {} : { nav: { ...nav, onStep: (by: -1 | 1) => stepFrom(open, by) } })}
      onGo={onGo}
      {...(onBack === undefined ? {} : { onBack })}
      onClose={onClose}
      onKeyDown={keys}
      compact={width < 540}
    />
  )
}

export interface CodeHost {
  /** What the kit's parts are given: none until the thread is known. */
  readonly shell: CodeShell | undefined
  /** The panel for the file open, at the workbench's width, or null. */
  readonly panel: (width: number) => ReactNode
}

/**
 * A thread's code, for its screen: `open` is the file open beside it, which
 * the screen keeps, as it keeps the document open there. `onOpen` opens one;
 * `onClose` closes it, back to what it went on top of where it did; and
 * `onCloseAll` closes it and that too, as its panel's Close does.
 */
export const useCodeHost = ({
  threadId,
  taskId,
  open,
  onOpen,
  onClose,
  onCloseAll,
}: {
  readonly threadId: string | null
  readonly taskId: string | null
  readonly open: CodeOpen | null
  readonly onOpen: (found: FoundCode, from: HTMLElement | null) => void
  readonly onClose: () => void
  readonly onCloseAll: () => void
}): CodeHost => {
  const { client, cache } = useServices()
  const editors = useCodeEditors(threadId ?? '')
  const main = editors.main

  // A name that wasn't a chip, as one of several of a name or one of nearly a missing one's: found, then opened in the same place.
  const go = (name: string, onTop: boolean) => {
    if (threadId === null) return
    void cache.fetchQuery(foundRead(client, cache, threadId, null, [name])).then((found) => {
      const named = found.get(name)
      if (named !== undefined) onOpen(named, onTop ? (open?.from ?? null) : null)
    })
  }

  // ⌥↓ and ⌥↑: the thread's next and last names, as long as nothing is being typed.
  useEffect(() => {
    if (threadId === null) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="menu"]') !== null)
      )
        return
      event.preventDefault()
      stepFrom(open, event.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [threadId, open])

  // The latest of what the kit's parts call, so what they are given changes only with what they show.
  const latest = useRef({ onOpen, onClose, go, inEditor: editors.open, taskId })
  useLayoutEffect(() => {
    latest.current = { onOpen, onClose, go, inEditor: editors.open, taskId }
  })
  const opened = open === null ? null : codeKey(open.found)
  const mainId = main?.id
  const shell = useMemo<CodeShell | undefined>(() => {
    if (threadId === null) return undefined
    return {
      useFound: function useFound(names) {
        const itemId = useContext(SaidIn)
        return useQuery(foundRead(client, cache, threadId, itemId, names)).data
      },
      peek: (found, from) => (
        <CodePeekOf
          found={found}
          threadId={threadId}
          // Not from the coordinator's, which has no task: there a press on the name is the one way beside.
          onBeside={latest.current.taskId === null ? undefined : () => latest.current.onOpen(found, from)}
          onGo={(name) => latest.current.go(name, false)}
        />
      ),
      open: (found, from) => latest.current.onOpen(found, from),
      ...(mainId === undefined ? {} : { openInEditor: (found: FoundCode) => latest.current.inEditor(mainId, found) }),
      opened,
      close: () => latest.current.onClose(),
    }
  }, [threadId, opened, mainId, client, cache])

  return {
    shell,
    panel: (width) =>
      threadId === null || open === null ? null : (
        <CodePanelOf
          key={codeKey(open.found)}
          open={open}
          threadId={threadId}
          taskId={taskId}
          width={width}
          onGo={(name) => go(name, open.onTop)}
          {...(open.onTop ? { onBack: onClose } : {})}
          onClose={onCloseAll}
        />
      ),
  }
}
