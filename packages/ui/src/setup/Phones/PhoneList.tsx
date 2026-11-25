import { useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './PhoneList.module.css'

/*
 * The phones a home has paired, as rows: the name each gave itself pairing,
 * when it paired, and Remove on hover. Removing asks first, then takes the
 * phone off at once: the home no longer accepts its key, and it can't open
 * the home again until it pairs again.
 */

export interface PairedPhone {
  readonly id: string
  readonly name: string
  /** When it paired, in words: "3 Nov", "Today". */
  readonly paired: string
  /** Paired in this window, a moment ago. */
  readonly fresh?: boolean
}

export interface PhoneListProps {
  /** The home, as the window names it. */
  readonly home: string
  readonly phones: ReadonlyArray<PairedPhone>
  /** Takes a phone off; left out, the rows have no Remove. */
  readonly onRemove?: (id: string) => void
  readonly dense?: boolean
}

/** Asks before a phone is taken off. */
export function RemovePhone({
  home,
  phone,
  onClose,
  onRemove,
}: {
  home: string
  phone: PairedPhone
  onClose: () => void
  onRemove: () => void
}) {
  return (
    <Dialog
      title={`Remove ${phone.name}?`}
      description={`It can’t open ${home} again until you pair it again.`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose()
              onRemove()
            }}
          >
            Remove
          </Button>
        </>
      }
    />
  )
}

export function PhoneList({ home, phones, onRemove, dense = false }: PhoneListProps) {
  const [asking, setAsking] = useState<PairedPhone | null>(null)
  return (
    <>
      <ul className={s.rows} data-dense={dense || undefined}>
        {phones.map((phone) => (
          <li key={phone.id} className={s.row} data-fresh={phone.fresh === true || undefined}>
            <span className={s.share}>
              <Icon name="phone" size={dense ? 13 : 14} className={s.icon} />
              <span className={s.words}>
                <span className={s.name} title={phone.name}>
                  {phone.name}
                </span>
                <span className={s.meta}>{phone.fresh === true ? 'Paired just now' : `Paired ${phone.paired}`}</span>
              </span>
            </span>
            {onRemove !== undefined && (
              <span className={s.remove}>
                <LinkButton className={s.danger} onClick={() => setAsking(phone)}>
                  Remove
                </LinkButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {asking !== null && onRemove !== undefined && (
        <RemovePhone home={home} phone={asking} onClose={() => setAsking(null)} onRemove={() => onRemove(asking.id)} />
      )}
    </>
  )
}
