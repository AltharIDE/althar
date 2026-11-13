import { describe, expect, it } from 'vitest'

import { Room } from '@althar/ui'

import { isHome, shownOf, toggled } from '../src/renderer/features/project/rooms'

/*
 * A project's home, its conversation and board shown and hidden by their
 * toggles: one always shows; from another view, a toggle goes home with its
 * pane showing.
 */

describe('the home’s panes', () => {
  it('are the home’s three layouts, and nothing of another view', () => {
    expect([Room.Both, Room.Talk, Room.Board].every(isHome)).toBe(true)
    expect([Room.Automations, Room.Artifacts, Room.Settings].some(isHome)).toBe(false)
    expect(shownOf(Room.Both)).toEqual({ talk: true, board: true })
    expect(shownOf(Room.Board)).toEqual({ talk: false, board: true })
    expect(shownOf(Room.Settings)).toEqual({ talk: false, board: false })
  })

  it('hide one where both show, show it again beside the other, and keep the only one showing', () => {
    expect(toggled(Room.Both, Room.Both, 'board')).toBe(Room.Talk)
    expect(toggled(Room.Both, Room.Both, 'talk')).toBe(Room.Board)
    expect(toggled(Room.Talk, Room.Talk, 'board')).toBe(Room.Both)
    expect(toggled(Room.Board, Room.Board, 'talk')).toBe(Room.Both)
    expect(toggled(Room.Talk, Room.Talk, 'talk')).toBe(Room.Talk)
    expect(toggled(Room.Board, Room.Board, 'board')).toBe(Room.Board)
  })

  it('go back home from another view, as it was where the pane showed there, beside the other where it didn’t', () => {
    expect(toggled(Room.Settings, Room.Board, 'board')).toBe(Room.Board)
    expect(toggled(Room.Settings, Room.Both, 'talk')).toBe(Room.Both)
    expect(toggled(Room.Automations, Room.Board, 'talk')).toBe(Room.Both)
  })
})
