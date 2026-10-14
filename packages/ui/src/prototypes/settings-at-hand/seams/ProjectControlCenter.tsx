// Scrappy: where the real project settings open from, in each direction. Their modules are the app's own.
import { useContext, useEffect } from 'react'
import { createPortal } from 'react-dom'

import { BarEnd } from '../../../../../../apps/desktop/src/renderer/features/tabs/TabsFrame'
import { ControlCenter as KitControlCenter, type ControlCenterProps } from '../../../setup/ControlCenter/ControlCenter'
import { Button } from '../../../primitives/Button/Button'
import { Heading } from '../../../primitives/Heading/Heading'
import type { ProjectInk } from '../../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../../foundations/ProjectMark/ProjectMark'
import { OnTask, proto, useCurrentProject, useProto } from '../state'
import type { ReactElement, Ref } from 'react'

/** The real trigger's ref, so focus still comes back to whatever opens it. */
const refOf = (trigger: ReactElement) => (trigger.props as { ref?: Ref<HTMLButtonElement> }).ref

export function ControlCenter(props: ControlCenterProps) {
  const { direction } = useProto()
  if (direction === 'A') return <FromTheName {...props} />
  if (direction === 'B') return <IntoTheOnePanel {...props} />
  if (direction === 'C') return <AsAView {...props} />
  return <OwnButton {...props} />
}

/* A: the project's name in the bar, before its views, opens its settings. */
function FromTheName(props: ControlCenterProps) {
  const project = useCurrentProject()
  if (project === null) return null
  return (
    <BarEnd>
      <div style={{ order: -1, display: 'flex' }}>
        <KitControlCenter
          {...props}
          trigger={
            <Button ref={refOf(props.trigger)} size="small" variant="quiet" trailingIcon="chevronD" data-proto="project-settings">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ProjectMark seed={project.id} ink={project.ink as ProjectInk} size={14} />
                {project.name}
              </span>
            </Button>
          }
        />
      </div>
    </BarEnd>
  )
}

/* B: no button of its own; its modules are the "This project" half of the one panel. */
function IntoTheOnePanel({ children }: ControlCenterProps) {
  const { slot } = useProto()
  useEffect(() => {
    proto.set({ project: true })
    return () => proto.set({ project: false })
  }, [])
  return slot === null ? null : createPortal(children, slot)
}

/* C: a view of the project's own, beside the conversation and the board. */
function AsAView({ children, text }: ControlCenterProps) {
  const { settingsView } = useProto()
  const onTask = useContext(OnTask)
  // The project's views are drawn by the time the person picks Settings among them.
  const rooms = settingsView ? document.querySelector<HTMLElement>('[class*="__rooms__"]') : null
  if (onTask || !settingsView || rooms === null) return null
  return createPortal(
    <div
      data-settings-view
      style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '28px 0 64px', display: 'flex', justifyContent: 'center' }}
    >
      <style>{'[class*="__rooms__"] > :not([data-settings-view]) { display: none !important }'}</style>
      <div style={{ width: 520, display: 'grid', gap: 14, alignContent: 'start' }}>
        <Heading level={2}>{text?.label ?? 'Settings'}</Heading>
        <div>{children}</div>
      </div>
    </div>,
    rooms,
  )
}

/* D: its own button where it is today, named for the project, with no gear. */
function OwnButton(props: ControlCenterProps) {
  const onTask = useContext(OnTask)
  if (onTask) return null
  return (
    <KitControlCenter
      {...props}
      trigger={
        <Button ref={refOf(props.trigger)} size="small" variant="quiet" icon="folder" data-proto="project-settings">
          Project settings
        </Button>
      }
    />
  )
}
