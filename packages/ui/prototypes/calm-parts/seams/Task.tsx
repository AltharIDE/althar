// Scrappy: a task's bar, as the direction has it: where it stands, its one press, its parts; what sits under the bar and over the composer.
import { TitleBar as RealTitleBar, type TitleBarProps } from '../../../src/chrome/TitleBar/TitleBar'
import { TaskHeader as RealTaskHeader, type TaskHeaderProps } from '../../../src/chrome/TaskHeader/TaskHeader'
import { Composer as RealComposer, type ComposerProps } from '../../../src/composer/Composer/Composer'
import { VIEWS } from '../directions'
import { needOf } from '../need'
import { proto, useProto } from '../state'

const overOf = () => {
  const p = proto.get()
  const c = proto.current()
  return VIEWS[p.direction].header(c, needOf(c, p.answered), p.opening)
}

export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  useProto()
  const over = overOf()
  const beside = over.beside ?? props.beside
  return (
    <RealTaskHeader {...props} status={over.status} state={over.state} parts={over.parts} {...(beside === undefined ? {} : { beside })} />
  )
}

export function TitleBar(props: TitleBarProps) {
  useProto()
  const over = overOf()
  return (
    <>
      <RealTitleBar {...props} />
      {over.under}
    </>
  )
}

export function Composer(props: ComposerProps) {
  const p = useProto()
  const mine = VIEWS[p.direction].above(proto.current(), p.opening)
  return (
    <RealComposer
      {...props}
      above={
        mine === null ? (
          props.above
        ) : (
          <>
            {mine}
            {props.above}
          </>
        )
      }
    />
  )
}
