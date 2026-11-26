import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RunningList } from '../src/composer/Running/Running'

describe('what runs, in its list', () => {
  it('says a run on a worker opens its preview, with the worker as where it runs', () => {
    const onOpenUrl = vi.fn()
    render(
      <RunningList
        processes={[{ id: 'run:1', command: 'bun run dev', url: 'preview', on: 'Linux worker 3f9a2c', since: '3m' }]}
        onOpenUrl={onOpenUrl}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    expect(onOpenUrl).toHaveBeenCalledWith('run:1')
    expect(screen.getByText('on Linux worker 3f9a2c')).toBeInTheDocument()
  })
})
