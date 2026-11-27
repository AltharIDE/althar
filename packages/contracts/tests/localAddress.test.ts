import { describe, expect, it } from 'vitest'

import { isLocalAddress } from '../src/localAddress'

describe('isLocalAddress', () => {
  it.each([
    'http://localhost:5173/',
    'http://localhost',
    'https://localhost:8443/x?y=1',
    'http://127.0.0.1:3000',
    'http://[::1]:8080/',
    'http://app.localhost:3000/',
    'HTTP://LOCALHOST:3000',
    'http://user:pw@localhost:3000/',
  ])('%s is local', (address) => expect(isLocalAddress(address)).toBe(true))

  it.each([
    'https://github.com/AltharIDE/althar',
    'https://localhost.evil.com/',
    'http://notlocalhost:3000',
    'http://127.0.0.2:3000',
    'http://192.168.1.4:3000',
    'http://localhost@evil.com/',
    'file:///etc/passwd',
    'ftp://localhost/',
    'javascript:alert(1)',
    'localhost:3000',
    'not an address',
    '',
  ])('%s is not', (address) => expect(isLocalAddress(address)).toBe(false))
})
