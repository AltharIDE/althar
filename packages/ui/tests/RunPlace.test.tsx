import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type BranchChoice, choiceKey, found, placeOf, type RunPlace, RunPlacePicker } from '../src/chrome/RunPlace/RunPlace'

const MAIN: RunPlace = { key: 'main', kind: 'main', label: 'main' }
const PR: BranchChoice = { kind: 'pull', number: 12, name: 'PR #12', title: 'Batch payouts', branch: 'feature/batch' }
const BRANCH: BranchChoice = { kind: 'branch', branch: 'release/2.4' }

describe('what the remote offers', () => {
  it('is found by number, title, branch and author', () => {
    expect(found([PR, BRANCH], 'batch')).toEqual([PR])
    expect(found([PR, BRANCH], '#12')).toEqual([PR])
    expect(found([PR, BRANCH], 'release')).toEqual([BRANCH])
  })

  it('offers a pull request’s number nobody listed', () => {
    expect(found([PR], '40')[0]).toMatchObject({ kind: 'pull', number: 40, name: '#40' })
  })

  it('becomes a place keyed as the choice is', () => {
    expect(placeOf(PR)).toMatchObject({ key: choiceKey(PR), kind: 'pull', label: 'PR #12', detail: 'Batch payouts' })
    expect(placeOf(BRANCH)).toMatchObject({ key: ':release/2.4', kind: 'branch', label: 'release/2.4' })
  })
})

describe('the place switcher', () => {
  it('says where Run runs, and lists the places, a known pull request once', () => {
    const known: RunPlace = { ...placeOf(PR), failed: 'Dashboard exited 1' }
    const task: RunPlace = { key: 'task:t1', kind: 'task', label: 'Refunds', running: ['Storybook'] }
    render(<RunPlacePicker current={MAIN} places={[MAIN, task, known]} remote={[PR, BRANCH]} onPick={vi.fn()} defaultOpen />)
    expect(screen.getByRole('button', { name: 'main' })).toBeInTheDocument()
    expect(screen.getAllByRole('option').map((one) => one.textContent)).toEqual([
      'main',
      'RefundsStorybook',
      'Batch payoutsPR #12feature/batchDashboard exited 1',
      'release/2.4',
    ])
  })

  it('opens on its field, picks with the keys, and closes', async () => {
    const onPick = vi.fn()
    render(<RunPlacePicker current={MAIN} places={[MAIN]} remote={[BRANCH]} onPick={onPick} defaultOpen />)
    const field = screen.getByRole('combobox')
    await waitFor(() => expect(field).toHaveFocus())
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'branch', label: 'release/2.4' }))
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('says it is asking the remote, and why it lists less', () => {
    const { rerender } = render(<RunPlacePicker current={MAIN} places={[MAIN]} remote={null} onPick={vi.fn()} defaultOpen />)
    expect(screen.getByText('Asking the remote…')).toBeInTheDocument()
    rerender(
      <RunPlacePicker current={MAIN} places={[MAIN]} remote={[]} note="Althar couldn’t reach origin." onPick={vi.fn()} defaultOpen />,
    )
    expect(screen.getByText('Althar couldn’t reach origin.')).toBeInTheDocument()
  })
})
