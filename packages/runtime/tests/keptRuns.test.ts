import { assert, describe, it } from '@effect/vitest'

import { filesNamed } from '../src/keptRuns'

/*
 * The files a run a task kept names, as its repository holds them: what has to be on the default branch for it to stay
 * once the task's worktree goes. Commands as leads keep them.
 */

describe('the files a kept run names', () => {
  it('follows its cd to the config it names, not the tool its install puts in node_modules', () => {
    assert.deepStrictEqual(filesNamed('cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/drafting/vite.config.ts'), [
      'apps/desktop/lab/drafting/vite.config.ts',
    ])
    assert.deepStrictEqual(
      filesNamed('cd packages/ui && PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vp dev --config prototypes/handoff/vite.config.mjs'),
      ['packages/ui/prototypes/handoff/vite.config.mjs'],
    )
    assert.deepStrictEqual(filesNamed('vp dev --config=lab/x.ts'), ['lab/x.ts'])
  })

  it('names nothing for a server by its port or address alone', () => {
    assert.deepStrictEqual(filesNamed('cd apps/desktop && bunx vp dev --port 6124 --host 127.0.0.1'), [])
    assert.deepStrictEqual(
      filesNamed('cd packages/ui && PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/storybook dev --port 6136 --ci --no-open'),
      [],
    )
    assert.deepStrictEqual(filesNamed('bun --filter @althar/desktop measure:startup'), [])
  })

  it('reads a script it runs, from the folder the project is about, and leaves out what lies outside the repository', () => {
    assert.deepStrictEqual(filesNamed('node apps/desktop/test-results/demo/demo.mjs'), ['apps/desktop/test-results/demo/demo.mjs'])
    assert.deepStrictEqual(filesNamed('./serve.sh', 'web'), ['web/serve.sh'])
    assert.deepStrictEqual(filesNamed('node ../elsewhere/run.js'), [])
    assert.deepStrictEqual(filesNamed('cd /Users/someone/frontend && bun .althar/scratch/explore-stack.ts > launcher.log'), [])
    assert.deepStrictEqual(filesNamed('cd lab; node a.js > a.log 2>&1'), ['lab/a.js'])
  })
})
