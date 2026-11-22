import { assert, describe, it } from '@effect/vitest'
import { namedByFindings } from '../src/findingPaths'

describe('a finding naming a file', () => {
  it('names the same repo path, however it is written', () => {
    assert.isTrue(namedByFindings(['src/a.ts'], 'src/a.ts'))
    assert.isTrue(namedByFindings(['./src/a.ts'], 'src/a.ts'))
    assert.isTrue(namedByFindings(['src\\a.ts'], 'src/a.ts'))
  })

  it('does not name a same-named file in another directory when located by its basename only', () => {
    assert.isFalse(namedByFindings(['index.ts'], 'src/index.ts'))
    assert.isFalse(namedByFindings(['README.md'], 'docs/README.md'))
    assert.isFalse(namedByFindings(['package.json'], 'packages/x/package.json'))
    assert.isFalse(namedByFindings(['packages/x/package.json'], 'package.json'))
  })

  it('still names the root file of that name', () => {
    assert.isTrue(namedByFindings(['README.md'], 'README.md'))
  })
})
