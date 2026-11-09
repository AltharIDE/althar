// Scrappy: a task's bar, as the direction has it: where it stands, its one press, its parts, and what follows its title; over the
// composer, what the direction puts there.
import { TitleBar as RealTitleBar, type TitleBarProps } from '../../../src/chrome/TitleBar/TitleBar'
import { TaskHeader as RealTaskHeader, type TaskHeaderProps } from '../../../src/chrome/TaskHeader/TaskHeader'
import { Composer as RealComposer, type ComposerProps } from '../../../src/composer/Composer/Composer'
import { VIEWS } from '../directions'
import { needOf } from '../need'
import { css } from '../parts'
import { proto, useProto } from '../state'

const overOf = () => {
  const p = proto.get()
  const c = proto.current()
  const view = VIEWS[p.direction]
  return view.header(c, view.need(c, needOf(c, p.answered)), p.opening)
}

export function TaskHeader<F extends string>(props: TaskHeaderProps<F>) {
  useProto()
  const over = overOf()
  const beside = over.beside ?? props.beside
  return (
    <RealTaskHeader
      {...props}
      className={[props.className, css.taskHead].filter(Boolean).join(' ')}
      status={over.status}
      state={over.state}
      parts={over.parts}
      {...(beside === undefined ? {} : { beside })}
    />
  )
}

export function TitleBar(props: TitleBarProps) {
  const p = useProto()
  const over = overOf()
  const crumb = VIEWS[p.direction].crumb(proto.current())
  return (
    <>
      <RealTitleBar {...props}>
        {props.children}
        {crumb}
      </RealTitleBar>
      {over.under}
    </>
  )
}

export function Composer(props: ComposerProps) {
  const p = useProto()
  const view = VIEWS[p.direction]
  const c = proto.current()
  // Where the direction puts the changes over the composer, they take the place of today's chip of the pull requests it listens to.
  const mine = view.above(c, p.opening)
  const placeholder = view.placeholder(c)
  return <RealComposer {...props} {...(placeholder === undefined ? {} : { placeholder })} above={mine === null ? props.above : mine} />
}
