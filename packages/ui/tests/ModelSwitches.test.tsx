import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelSwitches } from '../src/setup/ModelSwitches/ModelSwitches'

const named = (names: readonly string[]) => names.map((name) => ({ id: name.toLowerCase(), name }))

describe('an agent’s model switches', () => {
  it('find in a long list, and show a list grown short again whole, whatever was being found', () => {
    const long = named(['GLM-5.3', 'GLM-5.3-Flash', 'Kimi K3', 'Qwen3 Coder', 'MiniMax M3', 'Grok 5', 'DeepSeek V4', 'Gemini 3', 'GPT-6'])
    const view = render(<ModelSwitches agent="OpenCode" models={long} off={[]} onChange={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'glm' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    view.rerender(<ModelSwitches agent="OpenCode" models={named(['Kimi K3', 'Grok 5', 'GPT-6'])} off={[]} onChange={vi.fn()} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })
})
