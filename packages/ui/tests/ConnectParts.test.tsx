import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Icon } from '../src/foundations/Icon/Icon'
import { ConnectWays } from '../src/setup/ConnectCard/ConnectCard'
import { ConnectActions, ConnectCode, ConnectField, ConnectPerms } from '../src/setup/ConnectCard/ConnectParts'

/* The parts a connector's card is made of, as each is given. */

describe('a connector card’s parts', () => {
  it('copies a code with the clipboard the host gives', async () => {
    const write = vi.fn(() => Promise.resolve())
    render(<ConnectCode code="WDJB-MJHT" write={write} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy the code' })))
    expect(write).toHaveBeenCalledWith('WDJB-MJHT')
  })

  it('checks nothing more while what is in its field is being checked', () => {
    const onSubmit = vi.fn()
    render(<ConnectField label="Token" value="ghp_x" onChange={() => {}} onSubmit={onSubmit} submit="Check" busy />)
    fireEvent.submit(screen.getByRole('textbox', { name: /Token/ }).closest('form')!)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('sets scopes as code, and its presses from the left where asked', () => {
    const { container } = render(
      <>
        <ConnectPerms rows={[{ name: 'repo' }, { name: 'read:org' }]} mono />
        <ConnectActions align="start">
          <button type="button">Continue</button>
        </ConnectActions>
      </>,
    )
    expect(container.querySelector('dl')).toHaveClass('mono')
    expect(screen.getByRole('button', { name: 'Continue' }).parentElement).toHaveClass('start')
  })

  it('draws a plug for a way with no mark or icon of its own', () => {
    const plug = render(<Icon name="plug" size={15} />).container.innerHTML
    const onChoose = vi.fn()
    render(
      <ConnectWays
        label="Ways to connect Forgejo"
        ways={[{ id: 'token', title: 'Paste a token', line: 'Made on Forgejo' }]}
        onChoose={onChoose}
      />,
    )
    const way = screen.getByRole('button', { name: /Paste a token/ })
    expect(way.querySelector('svg')?.outerHTML).toBe(plug)
    fireEvent.click(way)
    expect(onChoose).toHaveBeenCalledWith('token')
  })
})
