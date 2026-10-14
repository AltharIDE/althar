// Scrappy: the kit as the task screen sees it, with what a path shows in its header and over its composer.
import { Composer as KitComposer, type ComposerProps, TaskHeader as KitTaskHeader, type TaskHeaderProps } from '@althar/ui'

import { AllowPill, Mark, TaskChip, TimedMark, timedOf } from '../parts'
import { useProto } from '../store'
import { words } from '../words'

export * from '@althar/ui'

/** Beside the task's menu: A's word, B's chip, C's word, D's time left. Today: nothing. */
function HeaderSlot() {
  const st = useProto()
  const own = st.taskMode === 'allow'
  const project = st.rules.permissions === 'allow' && st.taskMode === null
  switch (st.path) {
    case 'A':
      return own || project ? <Mark tip={words.A.badgeTip(project)}>{words.A.badge}</Mark> : null
    case 'B':
    case 'BC':
      return <TaskChip />
    case 'C':
      return own ? (
        <Mark tip={words.C.badgeTip}>{words.C.badge}</Mark>
      ) : project ? (
        <Mark tip={words.A.badgeTip(true)}>meridian allows everything</Mark>
      ) : null
    case 'D':
      return <TimedMark />
    default:
      return null
  }
}

export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  return (
    <KitTaskHeader
      {...props}
      actions={
        <>
          <HeaderSlot />
          {props.actions}
        </>
      }
    />
  )
}

/** D's pill floats over the composer, beside what the lead left running. */
export function Composer(props: ComposerProps) {
  const st = useProto()
  if (st.path !== 'D' || (timedOf(st) === null && st.ended === null)) return <KitComposer {...props} />
  return (
    <KitComposer
      {...props}
      above={
        <>
          {props.above || null}
          <AllowPill />
        </>
      }
    />
  )
}
