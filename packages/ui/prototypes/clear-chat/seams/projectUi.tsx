// Scrappy: the kit as the project's screen sees it here: the header carries the direction's own control.
import type { ComponentProps } from 'react'
import { useEffect, useState } from 'react'

import { ProjectHeader as RealProjectHeader } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import { Brief } from '../directions/Brief'
import s from '../directions/directions.module.css'
import { ProjectMenu } from '../directions/ProjectMenu'
import { proto, saidInChat, saidOnPage, useProto } from '../state'

export * from '../../../src/index'

/** Under this width the header's own buttons keep only their glyphs, the label in the tooltip. */
const NARROW = 980
const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return narrow
}

/** A: a page starts only from something said on the one before it. */
function NewPage({ narrow }: { narrow: boolean }) {
  const talk = useProto().talks.A
  return (
    <ChromeButton
      icon="create"
      label="New page"
      compact={narrow}
      disabled={!saidOnPage(talk)}
      className={saidOnPage(talk) ? undefined : s.off}
      onClick={proto.newPage}
    />
  )
}

/** B: the thread goes; the brief and the earlier chat stay. */
function NewChat({ narrow }: { narrow: boolean }) {
  const talk = useProto().talks.B
  return (
    <ChromeButton
      icon="plus"
      label="New chat"
      compact={narrow}
      disabled={!saidInChat(talk)}
      className={saidInChat(talk) ? undefined : s.off}
      onClick={proto.newChat}
    />
  )
}

/** C: what is settled and older talk is hidden; the same button shows it again. */
function Focus({ narrow }: { narrow: boolean }) {
  const talk = useProto().talks.C
  return (
    <ChromeButton
      icon={talk.focused ? 'expand' : 'compress'}
      label={talk.focused ? 'Show all' : 'Focus'}
      compact={narrow}
      aria-pressed={talk.focused}
      className={talk.focused ? s.on : undefined}
      onClick={proto.toggleFocus}
    />
  )
}

export function ProjectHeader(props: ComponentProps<typeof RealProjectHeader>) {
  const p = useProto()
  const narrow = useNarrow()
  if (p.direction === 'Today') return <RealProjectHeader {...props} />
  const talk = p.talks[p.direction]
  return (
    <RealProjectHeader
      {...props}
      parts={[]}
      run={
        <>
          {props.run}
          {p.direction === 'A' && <NewPage narrow={narrow} />}
          {p.direction === 'B' && (
            <>
              <Brief talk={talk} compact={narrow} />
              <NewChat narrow={narrow} />
            </>
          )}
          {p.direction === 'C' && <Focus narrow={narrow} />}
          <ProjectMenu direction={p.direction} talk={talk} parts={props.parts ?? []} />
        </>
      }
    />
  )
}
