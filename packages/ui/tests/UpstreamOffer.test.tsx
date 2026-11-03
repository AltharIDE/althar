import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UpstreamOffer } from '../src/setup/UpstreamOffer/UpstreamOffer'

/* The one offer to push a fork's tasks' branches to the repository it forks. */

describe('the offer to push upstream', () => {
  it('asks, says what stays, and takes either answer', () => {
    const onAccept = vi.fn()
    const onNotNow = vi.fn()
    render(<UpstreamOffer upstream="AltharIDE/althar" onAccept={onAccept} onNotNow={onNotNow} />)
    expect(screen.getByText('You can push to AltharIDE/althar now. Push new tasks’ branches there instead of your fork?')).toBeTruthy()
    expect(screen.getByText('Pull requests already open stay on your fork.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onNotNow).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Push there' }))
    expect(onAccept).toHaveBeenCalledOnce()
  })

  it('says why an answer didn’t go through', () => {
    render(<UpstreamOffer upstream="AltharIDE/althar" onAccept={() => {}} onNotNow={() => {}} error="You can’t push there yet." />)
    expect(screen.getByRole('alert').textContent).toBe('You can’t push there yet.')
  })
})
