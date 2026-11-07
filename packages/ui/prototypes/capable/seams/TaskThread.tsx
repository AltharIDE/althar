// Scrappy: the task's thread as the app draws it, with each direction's pieces where the thread's data marks them (a runtime notice whose words start with §).
import { Fragment } from 'react'

import { TaskThread as Built, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { ChildCard, CoordinatorActs, UnaskedStart } from '../directions/lineage/Lineage'
import { Marked } from '../directions/marks'
import { useProto } from '../state'

export type { TaskThreadProps }

export function TaskThread(props: TaskThreadProps) {
  const p = useProto()
  const piece = (mark: string) => {
    switch (mark) {
      case '§child':
        return p.surface === 'lineage' && p.direction !== 'Today' ? <ChildCard countdown={p.direction === 'B'} /> : null
      case '§coordinator':
        return p.surface === 'lineage' && p.direction !== 'Today' ? <CoordinatorActs speaker={p.direction === 'B'} /> : null
      case '§unasked':
        return p.surface === 'lineage' && p.direction !== 'Today' ? (
          <UnaskedStart title="Reviewers of a task’s own change run its tests" />
        ) : null
      default:
        return <Marked mark={mark} />
    }
  }
  return (
    <>
      {props.rounds.map((block) =>
        block.kind === 'althar' && block.text.startsWith('§') ? (
          <Fragment key={block.id}>{piece(block.text)}</Fragment>
        ) : (
          <Fragment key={block.id}>
            <Built {...props} rounds={[block]} />
          </Fragment>
        ),
      )}
    </>
  )
}
