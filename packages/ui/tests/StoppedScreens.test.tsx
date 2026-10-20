import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DataNotMoved } from '../src/screens/DataNotMoved/DataNotMoved'
import { OpenFailed } from '../src/screens/OpenFailed/OpenFailed'
import { ProfileInUse } from '../src/screens/ProfileInUse/ProfileInUse'

/*
 * The screens Althar shows when it can't open, off a Mac: the window's own
 * buttons drawn in the bar, wired to the window they are given.
 */

const windowed = () => ({ onClose: vi.fn(), onMinimize: vi.fn(), onToggleMaximize: vi.fn() })

describe('a screen Althar can’t get past, off a Mac', () => {
  it('closes the window from its bar when it couldn’t open', () => {
    const window = windowed()
    render(<OpenFailed reason="The database is locked." onRetry={() => {}} lights="drawn" window={window} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close the window' }))
    expect(window.onClose).toHaveBeenCalled()
  })

  it('minimizes the window from its bar while another Althar has the profile', () => {
    const window = windowed()
    render(<ProfileInUse reason="Another Althar has it open." onTryAgain={() => {}} lights="drawn" window={window} />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the window' }))
    expect(window.onMinimize).toHaveBeenCalled()
  })

  it('maximizes the window from its bar when an update couldn’t move the data', () => {
    const window = windowed()
    render(
      <DataNotMoved stopped="moving" backup="~/Library/Althar/before-0.5" reason="Migration 31 failed." lights="drawn" window={window} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Maximize the window' }))
    expect(window.onToggleMaximize).toHaveBeenCalled()
  })
})
