// Scrappy: a project's settings panel. In D, what the project runs is one of its modules, and opens out to the whole list; elsewhere, the app's own.
import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import {
  ControlCenter as RealControlCenter,
  type ControlCenterProps,
  ControlDetail,
  ControlGrid,
  ControlModule,
  ControlSheet,
  ControlWords,
} from '../../../src/setup/ControlCenter/ControlCenter'
import { AddForm, EditForm, label, ManageList } from '../parts'
import { useProto } from '../state'

type Mine = null | 'list' | 'add' | { edit: string }

/** The panel's grid, with what the project runs added to its modules. */
const withRuns = (children: ReactNode, module: ReactElement): ReactNode => {
  if (!isValidElement<{ children?: ReactNode }>(children) || children.type !== Fragment) return children
  return (
    <>
      {Children.map(children.props.children, (part) =>
        isValidElement<{ children?: ReactNode }>(part) && part.type === ControlGrid
          ? cloneElement(part, {}, ...Children.toArray(part.props.children), module)
          : part,
      )}
    </>
  )
}

export function ControlCenter(props: ControlCenterProps) {
  const p = useProto()
  const [mine, setMine] = useState<Mine>(p.opening === 'settings' ? 'list' : null)
  const { onOpenChange } = props
  // Opened on what it runs, once, for the page that shows it.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || p.direction !== 'D' || p.opening !== 'settings') return
    opened.current = true
    onOpenChange?.(true)
  }, [p.direction, p.opening, onOpenChange])
  if (p.direction !== 'D') return <RealControlCenter {...props} />
  const def = p.runnables.find((one) => one.id === p.defaultId)
  const module = (
    <ControlModule key="runs" title="What it runs" aside={String(p.runnables.length)} onClick={() => setMine('list')}>
      <ControlWords
        mark={<Icon name="terminal" size={22} />}
        title={def === undefined ? 'Nothing yet' : `${label(def)} by default`}
        line={def === undefined ? 'Ask the coordinator, or pick from package.json' : '⌘R runs it · ⇧⌘R runs anything'}
      />
    </ControlModule>
  )
  const back = () => setMine('list')
  const children =
    mine === null ? (
      withRuns(props.children, module)
    ) : mine === 'list' ? (
      <ControlDetail title="What it runs" onBack={() => setMine(null)} aside={`${p.runnables.length}`}>
        <ControlSheet>
          <ManageList onEdit={(id) => setMine({ edit: id })} onAdd={() => setMine('add')} />
        </ControlSheet>
      </ControlDetail>
    ) : mine === 'add' ? (
      <ControlDetail title="Add something to run" onBack={back}>
        <ControlSheet>
          <AddForm way="type" compact onDone={back} />
        </ControlSheet>
      </ControlDetail>
    ) : (
      <ControlDetail title="Edit" onBack={back}>
        <ControlSheet>
          <EditForm id={mine.edit} onDone={back} />
        </ControlSheet>
      </ControlDetail>
    )
  return (
    <RealControlCenter
      {...props}
      width={mine === null ? props.width : 600}
      onOpenChange={(next) => {
        if (!next) setMine(null)
        onOpenChange?.(next)
      }}
      onEscapeKeyDown={(event) => {
        if (mine !== null && !event.defaultPrevented) {
          event.preventDefault()
          setMine(mine === 'list' ? null : 'list')
          return
        }
        props.onEscapeKeyDown?.(event)
      }}
    >
      {children}
    </RealControlCenter>
  )
}
