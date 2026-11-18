import { assert, describe, it } from '@effect/vitest'

import { filesNamed } from '../src/keptRuns'

/*
 * The files a run a task kept names, as its repository holds them: what has to be on the default branch for it to stay
 * once the task's worktree goes. Commands as leads keep them.
 */

const files = (command: string, within?: string) => filesNamed(command, within)?.files ?? null

describe('the files a kept run names', () => {
  it('follows its cd to the config it names, not the tool its install puts in node_modules', () => {
    assert.deepStrictEqual(files('cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/drafting/vite.config.ts'), [
      'apps/desktop/lab/drafting/vite.config.ts',
    ])
    assert.deepStrictEqual(
      files('cd packages/ui && PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/vp dev --config prototypes/handoff/vite.config.mjs'),
      ['packages/ui/prototypes/handoff/vite.config.mjs'],
    )
    assert.deepStrictEqual(files('vp dev --config=lab/x.ts'), ['lab/x.ts'])
  })

  it('reads quoted and escaped words as the shell does', () => {
    assert.deepStrictEqual(files('node "lab/my script.js"'), ['lab/my script.js'])
    assert.deepStrictEqual(files("cd 'my app' && vp dev --config='lab/a b.ts'"), ['my app/lab/a b.ts'])
    assert.deepStrictEqual(files('node lab/my\\ script.js'), ['lab/my script.js'])
    assert.deepStrictEqual(files('node "lab/a;b.js" && echo "x && y"'), ['lab/a;b.js'])
  })

  it('names nothing for a server by its port or address alone', () => {
    assert.deepStrictEqual(files('cd apps/desktop && bunx vp dev --port 6124 --host 127.0.0.1'), [])
    assert.deepStrictEqual(
      files('cd packages/ui && PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/storybook dev --port 6136 --ci --no-open'),
      [],
    )
    assert.deepStrictEqual(files('bun --filter @althar/desktop measure:startup'), [])
  })

  it('reads a script it runs, from the folder the project is about, and leaves out where it writes and what lies outside', () => {
    assert.deepStrictEqual(files('node apps/desktop/test-results/demo/demo.mjs'), ['apps/desktop/test-results/demo/demo.mjs'])
    assert.deepStrictEqual(files('./serve.sh', 'web'), ['web/serve.sh'])
    assert.deepStrictEqual(files('node ../elsewhere/run.js'), [])
    assert.deepStrictEqual(files('cd lab; node a.js > a.log 2>&1'), ['lab/a.js'])
    assert.deepStrictEqual(filesNamed('cd /Users/someone/frontend && bun .althar/scratch/explore-stack.ts > launcher.log 2>&1'), {
      files: [],
      outside: ['/Users/someone/frontend'],
    })
  })

  it("can't tell what the shell works out, a quote never closed, or a cd out of the repository", () => {
    assert.isNull(filesNamed('node "$LAB/run.js"'))
    assert.isNull(filesNamed('node lab/*.js'))
    // A variable's name alone looks like no file, yet it may be one.
    assert.isNull(filesNamed('node "$SCRIPT"'))
    assert.isNull(filesNamed('cd apps/desktop && vp dev --config "$CONFIG"'))
    assert.isNull(filesNamed('vp dev --config=$CONFIG'))
    assert.isNull(filesNamed('node "lab/run.js'))
    assert.isNull(filesNamed('cd $HOME && node a.js'))
    assert.isNull(filesNamed('cd .. && node a.js'))
  })
})
