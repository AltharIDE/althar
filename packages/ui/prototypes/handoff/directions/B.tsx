// Scrappy: B, where it stands, first. Outputs becomes the face every task opens on: what waits on the person, what it built (the
// real What it made), every finding once with what became of it, and the rail of how it got here, each stop a way into the
// conversation; its pull request beside, as Outputs has it. The conversation, tidied as A's, is behind it.
import { type ReactNode, useMemo } from 'react'

import type { ThreadSnapshot } from '../../../../contracts/src/index'
import { Heading } from '../../../src/index'
import made from '../../../src/outputs/WhatItMade/WhatItMade.module.css'
import type { TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { reveal } from '../../../../../apps/desktop/src/renderer/features/task/reveal'
import { roundsOf } from '../../../../../apps/desktop/src/renderer/shared/rounds'
import { ago } from '../../../../../apps/desktop/src/renderer/shared/time'
import { FindingRow, NeedsYou, Rail } from '../parts'
import { tallyOf } from '../story'
import { History } from './A'
import s from './directions.module.css'
import { useStory } from './shared'

/** The conversation behind it: A's history, with nothing pinned; what waits on the person ends it, as the app has it. */
export function ThreadB(props: TaskThreadProps) {
  return <History {...props} />
}

/** Takes the person to a place in the conversation: its face, then the block, brought into view. */
const showInConversation = (itemId: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
  void reveal(itemId, async () => false)
}

export function Standing({ snapshot, made: whatItMade, alone = false }: { snapshot: ThreadSnapshot; made?: ReactNode; alone?: boolean }) {
  const rounds = useMemo(
    () => roundsOf({ items: snapshot.items, turnRunning: false, worktree: snapshot.task.worktree }, new Map(), (iso) => ago(iso)),
    [snapshot],
  )
  const { story } = useStory(rounds, snapshot.threadId, snapshot)
  return (
    <div className={alone ? s.standingAlone : s.standing}>
      {(story.yours.calls.length > 0 || story.yours.findings.length > 0) && (
        <section className={made.part}>
          <Heading level={2} className={made.label}>
            Needs you
          </Heading>
          <NeedsYou calls={story.yours.calls} findings={story.yours.findings} project={snapshot.project.name} />
        </section>
      )}
      {whatItMade}
      {story.ledger.length > 0 && (
        <section className={made.part}>
          <Heading level={2} className={made.label}>
            Review
            <span className={s.labelMore}>{`${story.cycles.length} rounds · ${tallyOf(story.ledger, true)}`}</span>
          </Heading>
          <div className={s.ledger}>
            {story.ledger.map((row) => (
              <FindingRow key={row.id} row={row} rounds={row.rounds} />
            ))}
          </div>
        </section>
      )}
      {story.rail.length > 1 && (
        <section className={made.part}>
          <Heading level={2} className={made.label}>
            How it got here
          </Heading>
          <Rail
            stops={story.rail}
            open={null}
            onOpen={(id) => id !== null && showInConversation(id === 'publish' ? (story.cycles.at(-1)?.id ?? id) : id)}
          />
        </section>
      )}
    </div>
  )
}
