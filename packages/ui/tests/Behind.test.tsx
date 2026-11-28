import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Behind } from '../src/composer/Behind/Behind'
import type { RunningProcess } from '../src/composer/Running/Running'

/*
 * The run chip on the composer's edge, held open by whoever holds the edge:
 * one thing open there at a time.
 */

const SITE: RunningProcess = { id: 'site', name: 'Site dev server', command: 'bun run dev', url: 'localhost:5173', since: '41m' }

/** The edge as the app holds it: what is open there, outside the chip. */
function Edge({ processes }: { readonly processes: ReadonlyArray<RunningProcess> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Behind processes={[...processes]} open={open} onOpenChange={setOpen} />
      <output>{open ? 'open' : 'folded'}</output>
    </>
  )
}

describe('the run chip, held open from outside', () => {
  it('closes as it goes with nothing behind the task, so back again its first press opens it', () => {
    const { rerender } = render(<Edge processes={[SITE]} />)
    fireEvent.click(screen.getByRole('button', { name: /Site dev server/ }))
    expect(screen.getByRole('dialog', { name: 'Behind this task' })).toBeTruthy()
    rerender(<Edge processes={[]} />)
    expect(screen.queryByRole('button', { name: /Site dev server/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('folded')
    rerender(<Edge processes={[SITE]} />)
    expect(screen.queryByRole('dialog', { name: 'Behind this task' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Site dev server/ }))
    expect(screen.getByRole('dialog', { name: 'Behind this task' })).toBeTruthy()
  })
})
