import { describe, expect, it } from 'vitest'

import { outsideAddress, threadLinkAddress } from '../src/main/externalLink'

const same = (address: string) => new URL(address).toString()

describe('what a window’s navigation hands to the person’s browser', () => {
  it.each(['https://github.com/AltharIDE/althar', 'http://localhost:5173/', 'http://[::1]:3000/', 'http://127.0.0.1:8080/'])(
    '%s opens',
    (address) => expect(outsideAddress(address)).toBe(same(address)),
  )
  it.each(['http://example.com/docs', 'file:///etc/passwd', 'javascript:alert(1)', 'vscode://open', 'not an address', ''])(
    '%s does not',
    (address) => expect(outsideAddress(address)).toBeNull(),
  )
})

describe('what a thread’s link hands there', () => {
  it.each(['https://github.com/AltharIDE/althar', 'http://example.com/docs', 'http://localhost:5173/'])('%s opens', (address) =>
    expect(threadLinkAddress(address)).toBe(same(address)),
  )
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'vscode://open', 'mailto:a@b.c', 'not an address', ''])('%s does not', (address) =>
    expect(threadLinkAddress(address)).toBeNull(),
  )
})
