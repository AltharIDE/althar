// Scrappy: B's conversation bar, above the thread: the transcript's name, and its clear beside it.
import { useState } from 'react'

import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import { ThreadMeasure } from '../../../src/thread/Thread/Thread'
import { hasConversation, useProto } from '../state'
import { ClearDialog, clearText } from './Clear'
import s from './directions.module.css'

export const headText = { title: 'Coordinator' }
const t = headText

export function ConversationHead() {
  const [asking, setAsking] = useState(false)
  const talk = useProto().talks.B
  const open = hasConversation(talk)
  return (
    <>
      <div className={s.headBar}>
        <ThreadMeasure>
          <div className={s.head}>
            <span className={s.headTitle}>{t.title}</span>
            <span className={s.headGrow} />
            <ChromeButton
              icon="remove"
              label={clearText.trigger}
              disabled={!open}
              className={open ? undefined : s.off}
              onClick={() => setAsking(true)}
            />
          </div>
        </ThreadMeasure>
      </div>
      {asking && <ClearDialog talk={talk} onClose={() => setAsking(false)} />}
    </>
  )
}
