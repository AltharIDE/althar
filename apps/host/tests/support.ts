import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { afterEach } from 'vitest'

const roots: string[] = []
export const temporary = (base = tmpdir()) => {
  const root = mkdtempSync(join(base, 'althar-host-test-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSync(root)
})
