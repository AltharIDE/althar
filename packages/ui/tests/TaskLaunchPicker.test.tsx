import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ModelPick } from '../src/composer/ModelPick/ModelPick'
import { PLAN_432 } from '../src/fixtures/coordinator'
import { MODEL_LIST } from '../src/fixtures/models'
import { TaskLaunch, type LaunchPick } from '../src/coordinator/TaskLaunch/TaskLaunch'

/* A row's picker opens where the row was pressed and stays there while it is used. */

function Card() {
  const [effort, setEffort] = useState('High')
  const picker = ({ agent, owner, onOpenChange }: LaunchPick) => (
    <ModelPick
      variant="field"
      placement="below"
      owner={owner}
      model={{ ...agent, efforts: ['Low', 'Medium', 'High'] }}
      pinned={MODEL_LIST}
      effort={effort}
      defaultEffort="High"
      onChange={() => {}}
      onEffort={setEffort}
      onOpenChange={onOpenChange}
    />
  )
  return (
    <TaskLaunch task="432" title="Backfill" project="Meridian" defaultSteps={PLAN_432} picker={picker} onStart={() => {}} defaultHeld />
  )
}

/** A row 684 wide, from the left edge: jsdom lays nothing out. */
const widen = (owner: RegExp) => {
  const row = screen.getByRole('button', { name: owner }).parentElement?.parentElement as HTMLElement
  row.getBoundingClientRect = () => ({ left: 0, right: 684, width: 684, top: 0, bottom: 56, height: 56, x: 0, y: 0, toJSON: () => ({}) })
}

/** What the row's picker is anchored to: the box its button lies in, which moves under the pointer. */
const anchor = (owner: RegExp) => screen.getByRole('button', { name: owner }).parentElement as HTMLElement

describe("a row's picker", () => {
  it('stays beside the press that opened it while a model or an effort is picked in it', async () => {
    render(<Card />)
    await act(async () => {})
    widen(/^Lead for this task:/)
    const lead = anchor(/^Lead for this task:/)
    // Pressed near the row's start, its anchor moves under the pointer and its picker opens there.
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Lead for this task:/ }), { clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: /^Lead for this task:/ }))
    const panel = await screen.findByRole('dialog', { name: /Lead for this task model and effort/ })
    const at = lead.style.left
    expect(at).toBe('92px')

    // A press far to the right, inside the picker (it is portaled out of the row, but React still passes it up through it), moves nothing.
    const effort = within(panel).getByRole('radio', { name: 'Medium' })
    fireEvent.pointerDown(effort, { clientX: 900 })
    expect(lead.style.left).toBe(at)
    await userEvent.click(effort)
    expect(lead.style.left).toBe(at)
    expect(within(panel).getByRole('radio', { name: 'Medium' })).toBeChecked()
    // Nor does a press on a model in its list.
    fireEvent.pointerDown(within(panel).getAllByRole('radio', { name: /./ })[0]!, { clientX: 700 })
    expect(lead.style.left).toBe(at)
  })

  it('is not dragged along by a press on the row while it is open', async () => {
    render(<Card />)
    await act(async () => {})
    widen(/^Lead for this task:/)
    const button = screen.getByRole('button', { name: /^Lead for this task:/ })
    fireEvent.pointerDown(button, { clientX: 60 })
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: /Lead for this task model and effort/ })
    fireEvent.pointerDown(button, { clientX: 500 })
    expect(anchor(/^Lead for this task:/).style.left).toBe('52px')
  })

  it("opens within its row, though pressed near the row's end", async () => {
    render(<Card />)
    await act(async () => {})
    widen(/^Lead for this task:/)
    // 684 wide, and its menu 328 (336 with room): it starts at 348 at the furthest, and its box still reaches the pointer.
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Lead for this task:/ }), { clientX: 660 })
    expect(anchor(/^Lead for this task:/).style.left).toBe('348px')
  })
})
