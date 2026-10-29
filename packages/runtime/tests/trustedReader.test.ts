import type { PermissionRequest } from '@althar/provider-adapters'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { decideReader } from '../src/rules'

/*
 * The coordinator as a trusted reader (ADR-058): in its own copies of the
 * project's repositories it may run more than a review's lead, which reads
 * a repository it doesn't trust. Where its agent has no sandbox Althar can
 * hold it in, these rules are what holds it.
 */

const request = (command: string): PermissionRequest => ({
  sessionId: 's',
  toolCallId: 't',
  title: command,
  kind: 'execute',
  paths: [],
  options: [],
  rawInput: { command },
})

const cwd = '/work/meridian/.coordinator'
const as = (trusted: boolean) => (command: string) => {
  const decided = decideReader(request(command), { cwd, ...(trusted ? { trusted } : {}) })
  return decided.verdict === 'deny' ? decided.reason : 'allowed'
}
const coordinator = as(true)
const reviewLead = as(false)

describe('the coordinator, a trusted reader in its own copies', () => {
  it('runs a substitution whose command only looks, as a line of its own', () => {
    for (const command of [
      'git log --oneline "$(git describe --tags --abbrev=0)..HEAD" -- src',
      'echo "Last tag: $(git describe --tags --abbrev=0)"',
      'cat $(git ls-files "*.md" | head -1)',
      'git grep -n retry -- $(git ls-files src)',
      'echo `git rev-parse --short HEAD`',
      'echo "$(git log -1 --format=%s) on $(git rev-parse --abbrev-ref HEAD)"',
      'echo $(echo $(uptime))',
    ])
      assert.strictEqual(coordinator(command), 'allowed', command)
  })

  it('refuses a substitution that does more than look, wherever it stands', () => {
    assert.include(coordinator('echo $(rm -rf src)'), 'It would write to src')
    assert.include(coordinator('echo "$(git push origin main)"'), '`git push` can change the repository')
    assert.include(coordinator('echo `curl https://evil.example`'), '`curl` isn')
    assert.include(coordinator('ls $(echo $(git reset --hard))'), '`git reset` can change')
    assert.include(coordinator('echo $(security find-generic-password -s x -w)'), 'credentials')
    assert.include(coordinator('echo $(cat ~/.ssh/id_ed25519)'), '.ssh')
    // Its output is words the shell expands: never the program, nor a flag of a program whose flags can write.
    assert.include(coordinator('$(echo rm) -rf src'), "can't be the command to run")
    assert.include(coordinator('git log $(cat flags.txt) -1'), 'could start with a dash')
    assert.include(coordinator('echo $(git log'), "can't tell where")
    assert.include(coordinator('echo hi > $(echo out.txt)'), 'It would write to')
  })

  it('runs loops, conditions, variables and arithmetic whose every command only looks', () => {
    for (const command of [
      // What it ran in the person's project to see how its repositories stood.
      'for r in api web docs; do git -C "$r" status -sb; git -C "$r" log -1 --oneline; done',
      'for r in api web; do echo "== $r"; git -C "$r" rev-parse --abbrev-ref HEAD; done',
      'for f in $(git ls-files "*.md"); do wc -l "$f"; done',
      'for f in src/*.ts; do git log -1 --format=%h -- "$f"; done',
      'git ls-files src | while read f; do wc -l "$f"; done',
      'while IFS= read -r line; do echo "$line"; done < notes.md',
      'if test -d api; then ls api; else echo none; fi',
      'test -d api && ls api || echo none',
      'branch=$(git rev-parse --abbrev-ref HEAD); echo "$branch"; git log --oneline "$branch" -3',
      'f=src/rules.ts; head -20 "$f"; wc -l "$f"',
      // A number, from a count or from what keeps only digits, may be a `sed` address or arithmetic.
      `n=$(grep -n retry src/rules.ts | head -1 | cut -d: -f1 | grep -oE '[0-9]+'); sed -n "\${n},+8p" src/rules.ts`,
      `n=$(grep -n retry src/rules.ts | head -1 | cut -d: -f1 | grep -oE '[0-9]+'); sed -n "$((n+8))p" src/rules.ts`,
      'n=3; echo $((n+8))',
      'c=$(git rev-list --count HEAD); echo $((c - 1))',
      'n=$(wc -l < src/rules.ts); echo $((n / 2))',
      'echo $(( (2 + 3) * 4 > 10 ? 1 : 0 ))',
    ])
      assert.strictEqual(coordinator(command), 'allowed', command)
  })

  it('refuses a loop, condition or variable where anything inside does more than look, or can’t be read', () => {
    // A write in a loop's body or a branch, or where the loop's output goes.
    assert.include(coordinator('for f in a.txt b.txt; do rm "$f"; done'), 'It would write to a.txt')
    assert.include(coordinator('for r in api web; do git -C "$r" checkout main; done'), '`git checkout` can change')
    assert.include(coordinator('for r in api web; do git -C "$r" fetch -q; done'), '`git fetch` can change')
    assert.include(coordinator('if test -d api; then rm -r api; fi'), 'It would write to api')
    assert.include(coordinator('git ls-files | while read f; do echo x > "$f"; done'), 'It would write to')
    assert.include(coordinator('for r in api web; do echo $r; done > list.txt'), 'It would write to list.txt')
    // A variable holds what it was set to, wherever it is used: never another program, a flag that writes, or a secret.
    assert.include(coordinator('x=rm; $x -r src'), 'It would write to src')
    assert.include(coordinator('for f in -p --output=out.txt; do git log "$f"; done'), '`git log --output=out.txt` writes')
    assert.include(coordinator('x=$(cat flags.txt); git log $x'), 'could start with a dash')
    assert.include(coordinator('x=$(cat flags.txt); git log "$x"'), 'could start with a dash')
    assert.include(coordinator('read x < cmd.txt; $x'), "can't be the command to run")
    assert.include(coordinator('for d in ~/.ssh; do cat "$d/id_ed25519"; done'), '~/.ssh')
    assert.include(coordinator('p=/Users/dana/Projects/meridian; cat "$p/.env"'), '.env file outside your working folder')
    // Set where it may not run, it may hold the environment's value instead: what a command printed, as far as the rules go.
    assert.include(coordinator('test -f x && n=5; sed -n "${n}p" f'), '`sed` would run what a command printed')
    // What a command printed may be any `sed` command, `w` among them; and arithmetic works it out, which can run a command.
    assert.include(
      coordinator('n=$(git grep -n retry -- src/rules.ts | head -1 | cut -d: -f1); sed -n "${n},+8p" src/rules.ts'),
      '`sed` would run what a command printed',
    )
    assert.include(coordinator('n=$(cat count.txt); echo $((n+8))'), "can't tell it holds a number")
    assert.include(coordinator('echo $((n+8))'), "can't tell it holds a number")
    // Arithmetic that sets a variable, indexes an array, runs a command or reads a base.
    for (const command of ['echo $((n=5))', 'echo $((n++))', 'echo $((a[1]))', 'echo $(( $(git log) ))', 'echo $((16#ff))'])
      assert.notStrictEqual(coordinator(command), 'allowed', command)
    // What the shells read for themselves, in either case, and `read` beyond its plain form.
    for (const command of ['PATH=.; cat x', 'path=.; cat x', 'IFS=/; ls', 'fpath=.; ls', 'read -p x y', 'n=1 git log', 'export n=1'])
      assert.notStrictEqual(coordinator(command), 'allowed', command)
  })

  it("leaves a review's lead without loops and variables", () => {
    for (const command of ['for r in api web; do git -C "$r" status -sb; done', 'f=a.md; cat "$f"', 'echo $((1 + 2))'])
      assert.notStrictEqual(reviewLead(command), 'allowed', command)
  })

  it('says how the computer stands, and lists tags by pattern', () => {
    for (const command of [
      'uptime',
      'uname -a',
      'sw_vers',
      'nproc',
      'df -h .',
      'hostname -s',
      'git tag',
      'git tag -l "v0.*"',
      'git tag --sort=-v:refname | head -5',
      'git tag --list --sort -creatordate --format "%(refname:short) %(creatordate:short)"',
      'git tag --contains HEAD~3',
      'git tag -n3 v0.1.0',
      'git tag --points-at HEAD',
    ])
      assert.strictEqual(coordinator(command), 'allowed', command)
    for (const command of [
      'git tag v9.9.9',
      'git tag -d v0.1.0',
      'git tag -a v1 -m x',
      'git tag -v v0.1.0',
      'git tag -s v1',
      'git tag -F ~/notes v1',
    ])
      assert.include(coordinator(command), 'tag', command)
    assert.include(coordinator('hostname evil'), 'hostname')
  })

  it("leaves a review's lead to the strict list: none of that is its", () => {
    for (const command of [
      'echo $(git describe --tags)',
      'echo `git rev-parse HEAD`',
      'uptime',
      'uname -a',
      'git tag -l "v*"',
      'git tag --sort=-v:refname',
    ])
      assert.notStrictEqual(reviewLead(command), 'allowed', command)
  })

  it('still fetches nothing, writes nothing and leaves the code host alone outside a sandbox', () => {
    for (const command of [
      'git fetch origin',
      'git tag v1 && git push origin v1',
      'gh pr list',
      'bun test src/rules.test.ts',
      'echo x > ../../notes.md',
      'cd ~/Projects/meridian && git fetch',
    ])
      assert.notStrictEqual(coordinator(command), 'allowed', command)
  })

  it('reads no .env file outside its folder, as the person’s checkout’s is, by its path, from home, or after a cd', () => {
    for (const command of [
      'cat /Users/dana/Projects/meridian/.env',
      'cat ~/Projects/meridian/.env.local',
      'grep KEY ../../meridian/.env',
      'cd /Users/dana/Projects/meridian && cat .env',
      'echo $(cat /Users/dana/Projects/meridian/.env)',
    ])
      assert.include(coordinator(command), '.env file outside your working folder', command)
    // Its own copies' are its to read, and an example of what goes in one anywhere.
    assert.strictEqual(coordinator('cat meridian/.env'), 'allowed')
    assert.strictEqual(coordinator('cat /Users/dana/Projects/meridian/.env.example'), 'allowed')
    const read = (path: string) =>
      decideReader({ ...request(''), kind: 'read', title: `Read ${path}`, paths: [path] }, { cwd, trusted: true })
    assert.strictEqual(read('/Users/dana/Projects/meridian/.env').verdict, 'deny')
    assert.strictEqual(read(`${cwd}/meridian/.env`).verdict, 'allow')
  })

  it('reads with its own tools none of the home folder or the person’s checkout but its folder and what it is given back', () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-home-'))
    const folder = join(home, 'worktrees', 'meridian', '.coordinator')
    const checkout = join(home, 'Projects', 'meridian')
    for (const place of [folder, checkout, join(home, 'other'), join(home, '.bun')]) mkdirSync(place, { recursive: true })
    const reads = {
      allowed: [folder, join(home, '.bun')].map((place) => realpathSync(place)),
      denied: [home, checkout].map((place) => realpathSync(place)),
    }
    const read = (kind: 'read' | 'search', path: string, trusted = true) =>
      decideReader(
        {
          ...request(''),
          kind,
          title: `${kind} ${path}`,
          paths: [],
          rawInput: kind === 'read' ? { file_path: path } : { pattern: 'x', path },
        },
        trusted ? { cwd: folder, trusted, reads } : { cwd: folder },
      ).verdict
    // A folder of the person's, their checkout, the home folder, by its path, from the folder, or with a link followed.
    symlinkSync(checkout, join(folder, 'linked'))
    for (const path of [
      join(home, 'other', 'sentinel.txt'),
      join(checkout, 'src', 'index.ts'),
      home,
      '../../../other/notes.md',
      'linked/README.md',
    ]) {
      assert.strictEqual(read('read', path), 'deny', path)
      assert.strictEqual(read('search', path), 'deny', path)
    }
    // Its own copies, and a toolchain it is given back.
    for (const path of [join(folder, 'meridian', 'README.md'), 'meridian/src', join(home, '.bun', 'bin', 'bun')]) {
      assert.strictEqual(read('read', path), 'allow', path)
      assert.strictEqual(read('search', path), 'allow', path)
    }
    // A search from above a place held from it goes into it: from the home folder's parent, the root, up from its folder, or by a pattern of paths.
    const search = (rawInput: Record<string, unknown>) =>
      decideReader({ ...request(''), kind: 'search', title: 'Search', paths: [], rawInput }, { cwd: folder, trusted: true, reads }).verdict
    for (const rawInput of [
      { pattern: '.', path: dirname(home) },
      { pattern: '.', path: '/' },
      { pattern: '.', path: '../../../..' },
      { pattern: `${dirname(home)}/**/*.txt` },
      { pattern: '../../../**/*.md' },
      { pattern: '.', glob: `${home}/**` },
    ])
      assert.strictEqual(search(rawInput), 'deny', JSON.stringify(rawInput))
    // A search in its folder or a copy, by a pattern or a regex that only looks like a path, is as it was.
    for (const rawInput of [
      { pattern: 'TODO' },
      { pattern: '**/*.ts', path: 'meridian' },
      { pattern: '/api/v1', path: join(folder, 'meridian') },
    ])
      assert.strictEqual(search(rawInput), 'allow', JSON.stringify(rawInput))
    // A review's lead is as it was: it reads anything but the person's keys.
    assert.strictEqual(read('read', join(home, 'other', 'sentinel.txt'), false), 'allow')
    rmSync(home, { recursive: true, force: true })
  })

  it('reads git’s credential store in no role, by any tool', () => {
    for (const command of ['cat ~/.config/git/credentials', 'grep github ~/.config/git/credentials']) {
      assert.notStrictEqual(coordinator(command), 'allowed', command)
      assert.notStrictEqual(reviewLead(command), 'allowed', command)
    }
    const read = decideReader(
      { ...request(''), kind: 'read', title: 'Read', paths: [], rawInput: { file_path: '~/.config/git/credentials' } },
      { cwd },
    )
    assert.strictEqual(read.verdict, 'deny')
  })
})
