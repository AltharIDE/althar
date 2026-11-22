import { useEffect } from 'react'

import { Heading, Logo, TaskHeader, TaskStatus, TitleBar } from '@althar/ui'

import { Shape } from './looks/coming/Shape'
import { Launch } from './looks/Launch'
import { lab, useLab, type View } from './state'
import s from './whatsNew.module.css'

/*
 * Althar's own page, a tab like a project's: its bar, and its two views.
 * What's new, the release on Althar's light (looks/Launch.tsx); Coming next,
 * the roadmap for the person to shape (looks/coming/Shape.tsx).
 */

export function WhatsNewScreen() {
  const { view } = useLab()
  // Opening it is looking at the update: the tab's dot goes.
  useEffect(() => {
    if (lab.get().unseen) lab.set({ unseen: false })
  }, [])
  return (
    <div className={s.project}>
      <TitleBar
        lights="none"
        className={s.bar}
        end={
          <TaskHeader<View>
            title="Althar"
            status={TaskStatus.Done}
            state="Up to date"
            faces={[
              { value: 'new', label: 'What’s new' },
              { value: 'coming', label: 'Coming next' },
            ]}
            face={view}
            onFace={(next) => lab.set({ view: next })}
            text={{ faces: 'View' }}
          />
        }
      >
        <Heading level={1} className={s.crumb}>
          <span className={s.crumbName}>
            <Logo size={18} />
            Althar
          </span>
        </Heading>
      </TitleBar>
      {/* Each view keeps its own scroll, and opens at its top. */}
      <div key={view} className={s.pageIn}>
        {view === 'new' ? <Launch /> : <Shape />}
      </div>
    </div>
  )
}
