import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProjectHeader } from '../src/chrome/ProjectHeader/ProjectHeader'
import { ProjectInk } from '../src/foundations/ProjectMark/drawing'
import { Room } from '../src/foundations/vocabulary'

describe('ProjectHeader home', () => {
  it('goes to the board when the mark and name are pressed', () => {
    const onRoom = vi.fn()
    render(<ProjectHeader name="Meridian" seed="meridian" ink={Object.values(ProjectInk)[0]!} room={Room.Settings} onRoom={onRoom} />)
    const home = screen.getByRole('button', { name: 'Meridian' })
    fireEvent.click(home)
    expect(onRoom).toHaveBeenCalledWith(Room.Board)
    expect(home.tagName).toBe('BUTTON')
  })
})
