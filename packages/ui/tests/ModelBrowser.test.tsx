import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelBrowser, type ModelBrowserProps } from '../src/composer/ModelBrowser/ModelBrowser'
import { effortFor, MODEL_LIST, RUNTIMES, UNKNOWN_MODEL } from '../src/fixtures/models'

function open(props: Partial<ModelBrowserProps> = {}) {
  const handlers = { onPick: vi.fn(), onClose: vi.fn(), onTogglePin: vi.fn(), onSetDefaultEffort: vi.fn(), onConnect: vi.fn() }
  render(
    <ModelBrowser
      models={[...MODEL_LIST, UNKNOWN_MODEL]}
      runtimes={RUNTIMES}
      value="claude-opus-5"
      pins={['gpt-5.2-codex']}
      defaultEffort={(m) => effortFor(m)}
      {...handlers}
      {...props}
    />,
  )
  const dialog = screen.getByRole('dialog')
  const search = within(dialog).getByRole('searchbox')
  const rows = () => within(dialog).getAllByRole('listitem')
  return { ...handlers, dialog, search, rows }
}

describe('ModelBrowser', () => {
  it('starts in the search, pinned first', () => {
    const { search, rows } = open()
    expect(search).toHaveFocus()
    expect(rows()[0]).toHaveAttribute('data-id', 'gpt-5.2-codex')
  })

  it('searches names, ids and runtime names; Enter uses the first', () => {
    const { search, rows, onPick, dialog } = open()
    fireEvent.change(search, { target: { value: 'openrouter' } })
    expect(rows().every((r) => r.textContent?.includes('OpenRouter'))).toBe(true)
    fireEvent.change(search, { target: { value: 'haiku' } })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('claude-haiku-4-5')
  })

  it('filters by pins and by runtime', () => {
    const { rows, dialog } = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Pinned/ }))
    expect(rows()).toHaveLength(1)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ollama/ }))
    expect(rows().map((r) => r.dataset.id)).toEqual(['qwen3-coder', 'devstral-small', UNKNOWN_MODEL.id])
    expect(within(dialog).getByRole('button', { name: /^Ollama/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: /^All/ }))
    expect(rows().length).toBeGreaterThan(3)
  })

  it('moves with the arrows and back to the search; ⌘P pins the focused row', () => {
    const { search, dialog, onTogglePin } = open()
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    const first = document.activeElement as HTMLElement
    expect(first).toHaveAttribute('data-use')
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(first)
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(dialog, { key: 'p', metaKey: true })
    expect(onTogglePin).toHaveBeenCalledWith('gpt-5.2-codex')
    fireEvent.keyDown(dialog, { key: 'p' })
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(dialog, { key: 'ArrowUp' })
    expect(search).toHaveFocus()
    /* Enter anywhere but the search is the focused button's own */
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    fireEvent.keyDown(dialog, { key: 'x' })
  })

  it('picks, pins, connects and closes', () => {
    const { dialog, onPick, onTogglePin, onConnect, onClose } = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /Use Kimi K2/ }))
    expect(onPick).toHaveBeenCalledWith('kimi-k2')
    fireEvent.click(within(dialog).getByRole('button', { name: /Pin Kimi K2/ }))
    expect(onTogglePin).toHaveBeenCalledWith('kimi-k2')
    fireEvent.click(within(dialog).getByRole('button', { name: /Connect/ }))
    expect(onConnect).toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a model from a runtime it does not know by the runtime id, and an empty search as none', () => {
    const { search, rows, dialog } = open({ runtimes: RUNTIMES.filter((r) => r.id !== 'ollama') })
    fireEvent.change(search, { target: { value: 'some-new' } })
    expect(rows()[0]).toHaveTextContent('ollama')
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.keyDown(dialog, { key: 'Enter' })
  })
})
