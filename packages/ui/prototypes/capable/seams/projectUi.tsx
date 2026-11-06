// Scrappy: the kit as the project's screen sees it here: its header has New task, and its composer, in B, starts a task as well as talking to the coordinator.
import { type ComponentProps, useEffect } from 'react'

import { ProjectHeader as RealProjectHeader } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { Composer as RealComposer } from '../../../src/composer/Composer/Composer'
import { Tooltip } from '../../../src/primitives/HoverCard/HoverCard'
import { Button } from '../../../src/primitives/Button/Button'
import { ComposerStart, composerText, useComposerDraft } from '../directions/start/ComposerStart'
import { NewTaskDialog } from '../directions/start/NewTaskDialog'
import { proto, useProto } from '../state'

export * from '../../../src/index'

export const newTaskText = { button: 'New task', key: 'N' }

/** New task opens what the direction has: the dialog, the composer set to a task, or the board's card. */
export const openNewTask = () => {
  const p = proto.get()
  if (p.surface !== 'start' || p.direction === 'Today') return
  if (p.direction === 'B') {
    proto.set({ to: 'task' })
    // The composer is in the conversation: from the board alone, the project opens beside it.
    if (window.location.hash.includes('room=board')) window.location.assign('#/projects/p1?room=both')
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 50)
    return
  }
  proto.set({ composing: true })
}

export function ProjectHeader(props: ComponentProps<typeof RealProjectHeader>) {
  const p = useProto()
  // N, where nothing is being written, as b steps through the views.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox], [role=textbox]')) return
      event.preventDefault()
      openNewTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (p.surface !== 'start' || p.direction === 'Today') return <RealProjectHeader {...props} />
  return (
    <>
      <RealProjectHeader
        {...props}
        run={
          <>
            <Tooltip label={newTaskText.button} kbd={newTaskText.key}>
              <Button variant="quiet" size="small" icon="plus" onClick={openNewTask}>
                {newTaskText.button}
              </Button>
            </Tooltip>
            {props.run}
          </>
        }
      />
      {p.direction === 'A' && p.composing && (
        <NewTaskDialog
          onCoordinator={(words) => {
            proto.set({ composing: false, to: 'coordinator', handed: words })
            if (window.location.hash.includes('room=board')) window.location.assign('#/projects/p1?room=both')
          }}
        />
      )}
    </>
  )
}

export function Composer(props: ComponentProps<typeof RealComposer>) {
  const p = useProto()
  const task = useComposerDraft()
  const { onChange } = props
  // Words handed from the dialog's "Ask the coordinator instead" land in the coordinator's composer.
  useEffect(() => {
    if (p.handed === null) return
    onChange(p.handed)
    proto.set({ handed: null })
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus(), 50)
  }, [p.handed, onChange])
  if (p.surface !== 'start' || p.direction !== 'B') return <RealComposer {...props} />
  const toTask = p.to === 'task'
  return (
    <RealComposer
      {...props}
      {...(toTask
        ? {
            value: task.draft.words,
            onChange: (words: string) => task.set({ words }),
            onSubmit: () => task.start(),
            placeholder: task.draft.small ? composerText.smallPlaceholder : composerText.placeholder,
            picker: <ComposerStart task={task} />,
            busy: false,
            queued: [],
          }
        : {})}
      above={
        <>
          {props.above}
          <ComposerStart.To />
        </>
      }
    />
  )
}
