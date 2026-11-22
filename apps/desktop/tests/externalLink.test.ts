import { describe, expect, it } from 'vitest'

import { outsideAddress } from '../src/main/externalLink'

describe('what goes to the person’s browser', () => {
  it.each(['https://github.com/AltharIDE/althar', 'http://example.com/docs', 'http://localhost:5173/', 'http://[::1]:3000/'])(
    '%s opens',
    (address) => expect(outsideAddress(address)).toBe(new URL(address).toString()),
  )
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'vscode://open', 'mailto:a@b.c', 'not an address', ''])('%s does not', (address) =>
    expect(outsideAddress(address)).toBeNull(),
  )
})
