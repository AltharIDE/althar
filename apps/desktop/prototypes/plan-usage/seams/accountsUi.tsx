// Scrappy: the kit as an agent's accounts (Settings › Agents) see it. In C, under each account's row, its usage in full: every window, where the numbers came from and how old, a fault in words. The kit's row has no slot, so each goes into its row from outside.
import { type AccountsProps, Accounts as KitAccounts } from '@althar/ui'
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { AccountReading } from '../parts/HomeUsage'
import { useProto } from '../store'

export * from '@althar/ui'

export function Accounts(props: AccountsProps) {
  const { d } = useProto()
  const usage = usePlanUsage()
  const ref = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState<ReadonlyArray<{ readonly id: string; readonly at: HTMLElement }>>([])
  const ids = props.accounts.map((account) => account.id).join(' ')
  useLayoutEffect(() => {
    if (d !== 'C') return
    const rows = [...(ref.current?.querySelectorAll<HTMLElement>('li[class*="__row__"]') ?? [])]
    const made = rows.flatMap((row, index) => {
      const id = props.accounts[index]?.id
      if (id === undefined) return []
      const at = document.createElement('div')
      at.style.display = 'contents'
      row.appendChild(at)
      return [{ id, at }]
    })
    setSlots(made)
    return () => {
      made.forEach((one) => one.at.remove())
      setSlots([])
    }
    // The rows, as the accounts listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, ids])
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <KitAccounts {...props} />
      {d === 'C' &&
        slots.map(({ id, at }) => {
          const account = usage?.accounts.find((one) => one.accountId === id)
          return account === undefined ? null : <Fragment key={id}>{createPortal(<AccountReading account={account} />, at)}</Fragment>
        })}
    </div>
  )
}
