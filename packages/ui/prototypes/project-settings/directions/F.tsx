// F · One column: the project's settings over its board, one calm column you read down, the switches first; no side nav, no index. Remove at the very end.
import { useLayoutEffect, useRef, useState } from 'react'

import { Button, LinkButton } from '../../../src/index'
import { Block, calm as c, useEscape, CodeAndIssues, Head, NoteLines, notesCount, RemoveLink, Shared, Switches, TaskLines } from '../calm'
import type { Things } from '../parts'
import { useProto } from '../state'

export function F({ things, onClose }: { things: Things; onClose: () => void }) {
  const p = useProto()
  const [all, setAll] = useState(p.showing === 'notes')
  const notes = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (p.showing === 'notes') notes.current?.scrollIntoView({ block: 'start' })
  }, [p.showing])
  useEscape(onClose)
  const count = notesCount(things)
  return (
    <div className={c.page}>
      <div className={c.column}>
        <Head
          things={things}
          end={
            <Button size="small" onClick={onClose} kbd="Esc">
              Done
            </Button>
          }
        />
        <Block title="Every task">
          <Switches things={things} />
        </Block>
        <div className={c.block}>
          <Block title="Code and issues">
            <CodeAndIssues things={things} />
          </Block>
          <Shared things={things} />
        </div>
        <Block title="How tasks run">
          <TaskLines things={things} />
        </Block>
        <div ref={notes}>
          <Block
            title="Notes the coordinator keeps"
            aside={count > 3 && <LinkButton onClick={() => setAll(!all)}>{all ? 'Latest only' : `All ${count}`}</LinkButton>}
          >
            <NoteLines things={things} {...(all ? {} : { most: 3 })} />
          </Block>
        </div>
        <div className={c.foot}>
          <span>Its repositories and branches stay where they are.</span>
          <RemoveLink things={things} />
        </div>
      </div>
    </div>
  )
}
