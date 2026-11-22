import { useState } from 'react'

import { Button, Code, ControlDetail, CopyButton, Dialog, Icon, LinkButton } from '@althar/ui'

import cc from '../../../../../packages/ui/src/setup/ControlCenter/ControlCenter.module.css'
import c from '../../../../../packages/ui/src/setup/Computers/Computers.module.css'
import { SheetFact } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import tt from '../../../../../packages/ui/src/setup/ToolTiles/ToolTiles.module.css'
import { type LabHome, type Phone, phones } from './world'
import { PHONE } from './icons'
import s from './phones.module.css'

/*
 * The phones a home has paired, as each direction lists them: a module
 * each, as Computers has its workers (A); a sheet a phone opens out to, with
 * Remove at its foot (A, B); and rows, for a popover or a dialog (B, C, D).
 * Removing asks first, then takes the phone off at once: the home no longer
 * accepts its key, and it can't open the home until it pairs again.
 */

export const seenWords = (phone: Phone) =>
  phone.fresh === true ? 'Paired just now' : phone.seen === 'now' ? 'Connected' : `Last here ${phone.seen}`
const pairedWords = (phone: Phone) => (phone.fresh === true ? 'Today' : phone.paired)

/** Ask, then take it off. */
export function RemovePhone({
  home,
  phone,
  onClose,
  onRemoved,
}: {
  home: LabHome
  phone: Phone
  onClose: () => void
  onRemoved?: () => void
}) {
  return (
    <Dialog
      title={`Remove ${phone.name}?`}
      description={`It can't open ${home.name} again until you pair it again.`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose()
              phones.remove(home.key, phone.id)
              onRemoved?.()
            }}
          >
            Remove
          </Button>
        </>
      }
    />
  )
}

/** A phone, as Computers has a worker: its round picture, its name, and where it stands. */
export function PhoneModule({ phone, onOpen }: { phone: Phone; onOpen: () => void }) {
  const connected = phone.seen === 'now'
  return (
    <button type="button" className={`${cc.module} ${cc.opens} ${c.module} ${c.third}`} onClick={onOpen}>
      <span className={c.head}>
        <span className={c.picture} aria-hidden="true">
          <Icon name={PHONE} size={16} />
        </span>
        <span className={c.names}>
          <span className={c.name} title={phone.name}>
            {phone.name}
          </span>
          <span className={c.kindLine}>Paired {pairedWords(phone)}</span>
        </span>
        <Icon name="chevron" size={11} className={c.chevron} />
      </span>
      <span className={c.glance}>
        <span className={c.standing}>
          <span className={c.state}>{connected ? 'Connected' : 'Away'}</span>
          <span className={c.line}>
            {phone.fresh === true ? 'Paired just now' : connected ? 'Open on it now' : `Last here ${phone.seen}`}
          </span>
        </span>
      </span>
    </button>
  )
}

/** A phone opened out: what it is, then Remove apart at the foot. */
export function PhoneSheet({
  home,
  phone,
  onBack,
  back = 'Computers',
}: {
  home: LabHome
  phone: Phone
  onBack: () => void
  back?: string
}) {
  const [asking, setAsking] = useState(false)
  return (
    <div className={tt.opened}>
      <ControlDetail title={phone.name} onBack={onBack} text={{ back }} aside="Phone">
        <div className={c.body}>
          <div className={`${tt.sheet} ${c.sheetGlance}`}>
            <div className={c.sheetReadings}>
              <span className={c.standing}>
                <span className={c.state}>{phone.seen === 'now' ? 'Connected' : 'Away'}</span>
                <span className={c.line}>{seenWords(phone)}</span>
              </span>
            </div>
            <div className={c.facts}>
              <SheetFact label="Opens">{home.name}</SheetFact>
              <SheetFact label="Paired">{pairedWords(phone)}</SheetFact>
              <SheetFact label="Device ID">
                <span className={c.inline}>
                  <Code className={c.id}>{phone.id}</Code>
                  <CopyButton value={phone.id} ghost />
                </span>
              </SheetFact>
            </div>
          </div>
          <div className={`${tt.foot} ${c.foot}`}>
            <LinkButton className={tt.danger} onClick={() => setAsking(true)}>
              Remove {phone.name}
            </LinkButton>
          </div>
        </div>
      </ControlDetail>
      {asking && <RemovePhone home={home} phone={phone} onClose={() => setAsking(false)} onRemoved={onBack} />}
    </div>
  )
}

/** Phones as rows: the name, where each stands, and Remove on hover, or a way in. */
export function PhoneRows({
  home,
  list,
  onOpen,
  removable = false,
  dense = false,
}: {
  home: LabHome
  list: ReadonlyArray<Phone>
  onOpen?: (id: string) => void
  removable?: boolean
  dense?: boolean
}) {
  const [asking, setAsking] = useState<Phone | null>(null)
  return (
    <>
      <ul className={s.rows} data-dense={dense || undefined}>
        {list.map((phone) => {
          const inner = (
            <>
              <Icon name={PHONE} size={dense ? 13 : 14} className={s.icon} />
              <span className={s.words}>
                <span className={s.name} title={phone.name}>
                  {phone.name}
                </span>
                <span className={s.meta}>Paired {pairedWords(phone)}</span>
              </span>
              <span className={s.end} data-now={phone.seen === 'now' || phone.fresh === true || undefined}>
                {phone.fresh === true ? 'Just now' : phone.seen === 'now' ? 'Connected' : phone.seen}
              </span>
            </>
          )
          return (
            <li key={phone.id} className={s.row} data-fresh={phone.fresh === true || undefined}>
              {onOpen === undefined ? (
                <div className={s.share}>{inner}</div>
              ) : (
                <button type="button" className={`${s.share} ${s.way}`} onClick={() => onOpen(phone.id)}>
                  {inner}
                </button>
              )}
              {removable && (
                <span className={s.remove}>
                  <LinkButton className={tt.danger} onClick={() => setAsking(phone)}>
                    Remove
                  </LinkButton>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {asking !== null && <RemovePhone home={home} phone={asking} onClose={() => setAsking(null)} />}
    </>
  )
}
