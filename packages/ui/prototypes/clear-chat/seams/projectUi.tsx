// Scrappy: the kit as the project's screen sees it here: its header's ⋯ has the direction's clear, its composer A's undo.
import { type ComponentProps, useEffect } from 'react'

import { ProjectHeader as RealProjectHeader } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { Composer as RealComposer } from '../../../src/composer/Composer/Composer'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { ProjectMenu } from '../directions/ProjectMenu'
import { proto, useProto } from '../state'

export * from '../../../src/index'

export function ProjectHeader(props: ComponentProps<typeof RealProjectHeader>) {
  const p = useProto()
  if (p.direction === 'Today') return <RealProjectHeader {...props} />
  return (
    <RealProjectHeader
      {...props}
      parts={[]}
      run={
        <>
          {props.run}
          <ProjectMenu direction={p.direction} talk={p.talks[p.direction]} parts={props.parts ?? []} />
        </>
      }
    />
  )
}

export const undoText = { cleared: 'Cleared.', forgotten: 'Forgotten.', undo: 'Undo' }

/** A: what was cleared or forgotten comes back from the composer's edge, until something is said or its time is up. */
function Undo({ kind, until }: { kind: 'view' | 'wipe'; until: number }) {
  useEffect(() => {
    const timer = window.setTimeout(proto.expire, Math.max(0, until - Date.now()))
    return () => window.clearTimeout(timer)
  }, [until])
  return (
    <div>
      {kind === 'wipe' ? undoText.forgotten : undoText.cleared} <LinkButton onClick={proto.undo}>{undoText.undo}</LinkButton>
    </div>
  )
}

export function Composer(props: ComponentProps<typeof RealComposer>) {
  const p = useProto()
  const undo = p.direction === 'A' ? p.talks.A.undo : null
  if (undo === null) return <RealComposer {...props} />
  return (
    <RealComposer
      {...props}
      notice={
        <>
          {props.notice}
          <Undo kind={undo.kind} until={undo.until} />
        </>
      }
    />
  )
}
