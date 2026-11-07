// Scrappy: B's brief, the coordinator's memory made visible and editable, opened from the project's header.
import { Fragment, useState } from 'react'

import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import { ActionButton } from '../../../src/primitives/ActionButton/ActionButton'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { Popover } from '../../../src/primitives/Popover/Popover'
import { proto, type Talk } from '../state'
import { ForgetDialog } from './Forget'
import s from './directions.module.css'

export const briefText = {
  button: 'What it knows',
  title: 'What it knows',
  count: (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`,
  empty: 'Nothing from the conversation.',
  forget: (what: string) => `Forget: ${what}`,
  startOver: 'Forget everything…',
}
const t = briefText

/** The words of a line without its marks, for what its button says to assistive technology. */
const plain = (text: string) => text.replaceAll('**', '')

/** A brief line's own emphasis, as the brief keeps it. */
const rich = (text: string) =>
  text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, at) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={at}>{part.slice(2, -2)}</strong> : <Fragment key={at}>{part}</Fragment>,
    )

export function Brief({ talk, compact = false }: { talk: Talk; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={t.title}
        placement="below"
        align="end"
        width={360}
        initialFocus="panel"
        trigger={<ChromeButton icon="knowledge" label={t.button} compact={compact} />}
      >
        <div className={s.brief}>
          <div className={s.briefHead}>
            <span className={s.briefTitle}>{t.title}</span>
            <span className={s.briefCount}>{t.count(talk.brief.length)}</span>
          </div>
          {talk.brief.length === 0 ? (
            <p className={s.briefEmpty}>{t.empty}</p>
          ) : (
            <ul className={s.briefList}>
              {talk.brief.map((line) => (
                <li key={line.id} className={s.briefLine}>
                  <span>{rich(line.text)}</span>
                  <ActionButton
                    icon="close"
                    size="small"
                    flush="end"
                    aria-label={t.forget(plain(line.text))}
                    onClick={() => proto.forgetLine(line.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {talk.brief.length > 0 && (
            <div className={s.briefFoot}>
              <LinkButton
                className={s.danger}
                onClick={() => {
                  setOpen(false)
                  setAsking(true)
                }}
              >
                {t.startOver}
              </LinkButton>
            </div>
          )}
        </div>
      </Popover>
      {asking && <ForgetDialog onClose={() => setAsking(false)} />}
    </>
  )
}
