// Scrappy: E's seams on the real screens: a conversation's face with the page beside it on its workbench, and its composer with
// the page's comments in it, sent with what the person writes.
import { Composer as BuiltComposer, type ComposerProps } from '../../../src/composer/Composer/Composer'
import { TaskFace as BuiltFace, type TaskFaceProps } from '../../../src/thread/TaskFace/TaskFace'
import { shown } from '../addresses'
import { Beside, benchWidth } from '../parts/Beside'
import { destinationOfThread, proto, sideScope, threadHere, useProto } from '../state'

export function BesideFace(props: TaskFaceProps) {
  const p = useProto()
  const thread = threadHere()
  // The coordinator's page is on its screen's own workbench (threadHost.tsx), which opens over the board beside it.
  const page = p.direction === 'E' && thread !== 'thc' ? p.side[thread] : undefined
  if (page === undefined) return <BuiltFace {...props} />
  return <BuiltFace {...props} panel={<Beside thread={thread} page={page} />} panelWidth={benchWidth(p.bench)} />
}

export function BesideComposer(props: ComposerProps) {
  const p = useProto()
  const thread = threadHere()
  const scope = sideScope(thread)
  const comments = p.direction === 'E' ? p.comments.filter((one) => one.scope === scope) : []
  if (comments.length === 0) return <BuiltComposer {...props} />
  const pages = new Set(comments.map((one) => one.address)).size
  const mine = new Set(comments.map((one) => one.id))
  const send = (body: string) => {
    proto.send(scope, destinationOfThread(thread), body)
    props.onChange?.('')
  }
  return (
    <BuiltComposer
      {...props}
      files={[
        ...comments.map((one, at) => ({
          id: one.id,
          name: `${at + 1}. ${one.note}`,
          meta: pages > 1 ? `${one.label} · ${shown(one.address)}` : one.label,
          reading: one.crop === 'drawing',
        })),
        ...(props.files ?? []),
      ]}
      onRemoveFile={(id) => (mine.has(id) ? proto.remove(id) : props.onRemoveFile?.(id))}
      onSubmit={send}
      onSendNow={send}
    />
  )
}
