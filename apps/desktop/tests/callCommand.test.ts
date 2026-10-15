import { describe, expect, it } from 'vitest'

import { commandOf, titleOf } from '../src/renderer/shared/callCommand'

const call = (title: string, command: string | null = title, label?: string) => ({
  title,
  command,
  ...(label === undefined ? {} : { label }),
})

describe('callCommand', () => {
  it('keeps a short one-command title as it is, with no preview', () => {
    expect(titleOf(call('bun test'))).toBe('bun test')
    expect(commandOf(call('bun test'))).toEqual({})
  })

  it('gives a command chain a plain heading and the command once', () => {
    expect(titleOf(call('a && b && c'))).toBe('Run commands')
    expect(commandOf(call('a && b && c'))).toEqual({ command: 'a && b && c' })
  })

  it('gives a long script a plain heading and shows its label once', () => {
    const script = `cd /x && python3 - <<'EOF'\n${'print(1)\n'.repeat(30)}EOF\nls`
    expect(titleOf(call(script))).toBe('Run a script')
    expect(commandOf(call(script, script, 'short'))).toEqual({ command: 'short' })
  })

  it('leaves a written title alone and shows the command under it', () => {
    expect(titleOf(call('Run the tests', 'bun test'))).toBe('Run the tests')
    expect(commandOf(call('Run the tests', 'bun test'))).toEqual({ command: 'bun test' })
  })
})
