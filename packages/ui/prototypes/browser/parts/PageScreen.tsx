// Scrappy: A's page screen: a page open in Althar's browser, with the window, under the window's bar.
import { createPortal } from 'react-dom'

import { IconButton } from '../../../src/primitives/IconButton/IconButton'

import { verdictOf } from '../addresses'
import { addressOf, destinationOf, proto, TASK, useProto } from '../state'
import { Bar, Line } from './Bar'
import { Frame } from './Frame'
import { Gathered } from './Gathered'
import { glyph } from './icons'
import s from './Screens.module.css'
import { Absent, Blank, SignIn } from './Stand'

export function PageScreen({ top }: { top: number }) {
  const p = useProto()
  const page = p.pages.find((one) => one.id === p.page)
  if (page === undefined) return null
  const address = addressOf(page)
  const verdict = verdictOf(address)
  return createPortal(
    <div className={`ch-root ${s.over}`} style={{ top, bottom: p.bare ? 0 : 44 }}>
      <div className={s.screen}>
        <Bar
          scope={page.id}
          page={page}
          session="page"
          pointable={verdict.kind === 'page'}
          // E: a page taken out of a conversation's side goes back there.
          {...(p.direction === 'E' && page.from !== null
            ? {
                after: (
                  <IconButton
                    icon={glyph('dock')}
                    label={page.from.kind === 'coordinator' ? 'Back beside the conversation' : 'Back beside the task'}
                    size="small"
                    tooltipAlign="end"
                    onClick={() => proto.dock(page.id)}
                  />
                ),
              }
            : {})}
        />
        <Line scope={page.id} />
        {verdict.kind === 'page' ? (
          <Frame
            key={page.id}
            scope={page.id}
            address={address}
            src={verdict.src}
            reloads={page.reloads}
            onFollow={(next) => proto.navigate(page.id, next)}
            onTitle={(title) => proto.title(page.id, title)}
          />
        ) : verdict.kind === 'signin' ? (
          <SignIn verdict={verdict} scope={page.id} first={page.at === 0} />
        ) : verdict.kind === 'absent' ? (
          <Absent verdict={verdict} />
        ) : (
          <Blank scope={page.id} />
        )}
        <Gathered
          scope={page.id}
          to={destinationOf(page)}
          onTo={(to) => proto.sendTo(page.id, to)}
          onOpenSent={(to) => {
            proto.showPage(null)
            window.location.assign(to.kind === 'task' ? `#/threads/${TASK.threadId}` : '#/projects/p1?room=both')
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
