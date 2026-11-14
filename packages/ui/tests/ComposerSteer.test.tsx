import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from '../src/composer/Composer/Composer'

const field = () => screen.getByRole('textbox')

const mount = (steer: boolean) => {
  const onSubmit = vi.fn()
  const onSendNow = vi.fn()
  render(
    <Composer
      value="Use the fixture log."
      placeholder="Tell the lead"
      onChange={() => {}}
      onSubmit={onSubmit}
      onSendNow={onSendNow}
      busy
      steer={steer}
    />,
  )
  return { onSubmit, onSendNow }
}

describe('what Enter does while the agent works', () => {
  it('queues, by default, and Command+Enter or Send now steers', () => {
    const { onSubmit, onSendNow } = mount(false)
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('Use the fixture log.')
    expect(onSendNow).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, ctrlKey: true })
    expect(onSendNow).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Queue' })).toBeTruthy()
  })

  it('steers, set to, and Command+Enter or Queue queues', () => {
    const { onSubmit, onSendNow } = mount(true)
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSendNow).toHaveBeenCalledWith('Use the fixture log.')
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Queue' })[0]!)
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSendNow).toHaveBeenCalledTimes(1)
  })
})
