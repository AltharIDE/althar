import { resolve } from 'node:path'

import type { PermissionRequest } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'

import { decide, decideInside, decideReader, gitRunsOf, parseCommandLine, type RuleContext, shortCommand, tallyKindOf } from '../src/rules'

/*
 * How the rules read a line where they read it only in part: what a script,
 * a program of the task's or another shell runs, a script handed to
 * PowerShell or cmd, the remote a push names, and what an ask is counted as.
 */

const worktree = '/work/meridian/retry/app'
const context: RuleContext = { worktree, defaultBranch: 'main', taskBranch: 'althar/retry', currentBranch: 'althar/retry' }

const command = (line: string): PermissionRequest => ({
  sessionId: 's',
  toolCallId: 'c',
  title: line,
  kind: 'execute',
  paths: [],
  rawInput: { command: line },
  options: [],
})

/** A project that never allows a deploy, which nothing at the sandbox's boundary stops. */
const neverDeploys: RuleContext = {
  ...context,
  project: { mode: 'allow', ask: [], never: ['deploy'], allow: [], commands: [] },
}

describe('what Althar can’t read in a line its sandbox holds', () => {
  it('runs it anyway, even beside a project’s Never: only what the rules can read is refused (ADR-097)', () => {
    for (const line of [
      '$(echo hi)',
      'node fix.js',
      'ts-node fix.ts',
      'npx tsx fix.ts',
      'bunx --bun tsx fix.ts',
      'bun fix.ts',
      'bun --watch fix.ts',
      'bun run tools/fix.ts',
      'bun -p 1',
      'deno eval 1',
      'deno repl',
      'deno fix.ts',
      'sh fix.sh',
      'zsh',
      './x/run',
      'FOO=1 ./fix.sh',
    ])
      assert.deepStrictEqual(decideInside(command(line), neverDeploys), { verdict: 'allow' }, line)
    // Written out, the deploy the project never allows is read, and refused.
    assert.deepStrictEqual(decideInside(command('npm publish'), neverDeploys), {
      verdict: 'deny',
      reason: "The project's rules never allow deploying and publishing.",
    })
  })
})

describe('a script handed to PowerShell or cmd', () => {
  const read = (line: string) => {
    const parsed = parseCommandLine(line)
    return { commands: parsed.commands, opaque: parsed.opaque }
  }

  it('is read as the commands it runs, however its command is named', () => {
    assert.deepStrictEqual(read('pwsh -c "rm x"'), { commands: [['rm', 'x']], opaque: false })
    assert.deepStrictEqual(read('pwsh -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item x"'), {
      commands: [['Remove-Item', 'x']],
      opaque: false,
    })
    assert.deepStrictEqual(read('powershell.exe -command Remove-Item -Recurse src'), {
      commands: [['Remove-Item', '-Recurse', 'src']],
      opaque: false,
    })
    // Its first word that isn't an option starts the script.
    assert.deepStrictEqual(read('pwsh Get-ChildItem'), { commands: [['Get-ChildItem']], opaque: false })
    for (const [line, commands] of [
      ['cmd /k dir', [['dir']]],
      ['cmd /c "del x"', [['del', 'x']]],
      ['cmd.exe /c rd /s /q build', [['rd', '/s', '/q', 'build']]],
    ] as const)
      assert.deepStrictEqual(read(line), { commands, opaque: false }, line)
  })

  it('can’t be read where it is encoded or comes from its input', () => {
    for (const line of ['powershell -EncodedCommand abc', 'pwsh -ec abc', 'pwsh -enc abc', 'powershell -Command -', 'powershell -Command'])
      assert.isTrue(read(line).opaque, line)
  })

  it('is left as it is where it runs a file, or there is none', () => {
    assert.deepStrictEqual(read('pwsh -File fix.ps1'), { commands: [['pwsh', '-File', 'fix.ps1']], opaque: false })
    assert.deepStrictEqual(read('pwsh'), { commands: [['pwsh']], opaque: false })
  })
})

describe('the git a line runs', () => {
  it('names the remote a push goes to: by --repo, else its first word that isn’t an option', () => {
    const pushes = (line: string) => gitRunsOf(line, context).map((run) => run.push?.remote)
    assert.deepStrictEqual(pushes('git push'), [undefined])
    assert.deepStrictEqual(pushes('git push --repo=up main'), ['up'])
    assert.deepStrictEqual(pushes('git push --repo up'), ['up'])
    assert.deepStrictEqual(pushes('git push -o ci.skip origin main'), ['origin'])
  })

  it('is in the folder it runs in, where Althar can tell, its assignments and redirects left out', () => {
    assert.deepStrictEqual(gitRunsOf('git -C /elsewhere push origin', context), [
      { words: 'git -C /elsewhere push origin', folder: resolve('/elsewhere'), push: { remote: 'origin' } },
    ])
    assert.deepStrictEqual(gitRunsOf('FOO=1 git status > out.txt', context), [{ words: 'git status', folder: worktree }])
    // After a `cd` it can't follow, the folder isn't known, nor so where the push goes.
    assert.deepStrictEqual(gitRunsOf('cd /x && git push', context), [{ words: 'git push', folder: undefined }])
  })
})

describe('what an ask or a refusal is counted as', () => {
  const asking: RuleContext = {
    ...context,
    project: { mode: 'rules', ask: [], never: [], allow: [], commands: [{ pattern: 'ls', decision: 'ask' }] },
  }

  it('is the firmest of what decided it: credentials, a command the project named, then the rest', () => {
    for (const [line, kind] of [
      ['security find-generic-password -w', 'credentials'],
      ['cat ~/.ssh/id_rsa', 'credentials'],
      // A merge is the irreversible kind it is now: no separate code-host wall keeps it.
      ['gh pr merge 1', 'deploy'],
      ['ls', 'command'],
      ['git push --force origin main', 'force-push'],
      ['npm publish', 'deploy'],
    ] as const)
      assert.strictEqual(tallyKindOf(command(line), asking), kind, line)
    const read: PermissionRequest = { ...command(''), kind: 'read', paths: ['/srv/notes.md'], rawInput: { path: '/srv/notes.md' } }
    assert.strictEqual(tallyKindOf(read, context), 'other')
  })
})

describe('what a reader may hand on from a substitution', () => {
  const cwd = '/work/meridian/.coordinator'
  const verdictOf = (line: string) => decideReader(command(line), { cwd, trusted: true }).verdict
  /** A line that hands what the command printed to `sed` as its script, which runs only where it is a number. */
  const asSedLine = (inner: string) => verdictOf(`n=$(${inner}); sed -n "\${n}p" notes.md`)

  it('hands a number to sed: a count, or a pipeline that keeps only digits, as its pattern says', () => {
    for (const inner of [
      'wc -c',
      'head -1 f | wc -w',
      "tr -dc '[:digit:]'",
      "cat f | grep -oE '[0-9]+'",
      "cat f | grep -oE '[0-9]+' | head -1",
      "cat f | grep -o '[0-9][0-9]*'",
      "cat f | grep -xE '[[:digit:]]+'",
      "cat f | grep '^[0-9][0-9]*$'",
      "cat f | grep -E '^[0-9]+$'",
    ])
      assert.strictEqual(asSedLine(inner), 'allow', inner)
  })

  it('hands sed nothing that may be more than digits: `+` in a basic pattern, a pattern not held to the line, another class', () => {
    for (const inner of [
      "cat f | grep -o '[0-9]+'",
      "cat f | grep -x '[[:digit:]]+'",
      "cat f | grep '[0-9]+'",
      "cat f | grep -oE '[a-z]+'",
      "cat f | grep -oc '[0-9]+'",
      "grep -oE '[0-9]+' f",
    ])
      assert.strictEqual(asSedLine(inner), 'deny', inner)
  })

  it('hands git only a name: a describe, a merge base, the current branch or a commit, never what could be a flag', () => {
    for (const line of [
      'git show $(git describe --tags)',
      'git log $(git merge-base HEAD main)..HEAD',
      'git log $(git branch --show-current)',
      'git show $(git rev-parse HEAD)',
      'git show $(git rev-parse --abbrev-ref HEAD)',
    ])
      assert.strictEqual(verdictOf(line), 'allow', line)
    for (const line of [
      'git log $(git branch -a)',
      'git show $(git branch --show-current x)',
      'git show $(git rev-parse --show-toplevel)',
      'git show $(git rev-parse "HEAD*")',
      'git show $(git status)',
      'git show $(git log -1)',
      'git show $(ls; ls)',
      'git show $(echo x)',
    ])
      assert.strictEqual(verdictOf(line), 'deny', line)
  })
})

describe('what a reader’s variables hold', () => {
  const cwd = '/work/meridian/.coordinator'
  const verdictOf = (line: string) => decideReader(command(line), { cwd, trusted: true }).verdict

  it('is what a loop, a read or an assignment set them to, read where they are used', () => {
    for (const line of [
      'for f in a.md b.md; do cat "$f"; done',
      'for f in $(git ls-files); do cat "$f"; done',
      'for f; do cat "$f"; done',
      'while IFS= read -r line; do echo "$line"; done < notes.md',
      'x=1 y=2; git show "$x"',
      'x=$(wc -l < f); sed -n "${x}p" notes.md',
      'x=$(wc -l < f) && sed -n "${x}p" notes.md',
      'for n in 1 2; do sed -n "${n}p" notes.md; done',
      'for n in $((1+1)); do sed -n "${n}p" notes.md; done',
      'n=$((2*3)); sed -n "${n}p" notes.md',
      'n=5; echo $(( n + 1 ))',
      'n=$(wc -l < f); echo $(( n + 1 ))',
    ])
      assert.strictEqual(verdictOf(line), 'allow', line)
  })

  it('may be what a command printed wherever that could reach them: set in a block, a pipe, before another value, or by read', () => {
    for (const line of [
      'if true; then x=$(wc -l < f); fi; sed -n "${x}p" notes.md',
      '{ x=$(ls); }; sed -n "${x}p" notes.md',
      'x=$(ls) | cat; sed -n "${x}p" notes.md',
      'x=$(ls); x=1; sed -n "${x}p" notes.md',
      'for n in $(ls); do sed -n "${n}p" notes.md; done',
      'while read a b; do git show "$a"; done < notes.md',
      'n=$(ls); echo $(( n + 1 ))',
      'n=$(( $(ls) )); sed -n "${n}p" notes.md',
    ])
      assert.strictEqual(verdictOf(line), 'deny', line)
  })

  it('isn’t read where the line isn’t a loop or a read Althar knows', () => {
    for (const line of ['for 1x in a; do cat x; done', 'for f of a; do cat x; done', 'while read -r; do echo x; done < notes.md'])
      assert.strictEqual(verdictOf(line), 'deny', line)
  })
})

describe('a command, said short', () => {
  it('leaves out the cds before it, what only trims its output, and what only runs it', () => {
    for (const [line, said] of [
      ['cd a && pushd b; npm test | tail -20', 'npm test'],
      ['cd a ; cd b ; ls', 'ls'],
      ['sudo npm test 2>&1 | grep x', 'npm test'],
      ['FOO=1 npm test > out.log && npm run lint || echo failed', 'npm test && npm run lint || echo failed'],
      ['npm test\nnpm run lint', 'npm test; npm run lint'],
      ['tail -5', 'tail -5'],
      ['cd a', 'cd a'],
    ])
      assert.strictEqual(shortCommand(line ?? ''), said, line)
  })

  it('is said whole where it can’t be read, or holds a heredoc', () => {
    for (const line of ['echo $(date)', "cat <<'EOF'\nx\nEOF"]) assert.strictEqual(shortCommand(line), line)
  })
})

describe('where a copy or xargs writes', () => {
  const outside: RuleContext = { ...context, project: { mode: 'rules', ask: ['outside'], never: [], allow: [], commands: [] } }
  const verdictOf = (line: string) => decide(command(line), outside)

  it('is the folder a copy names, however its option is written, or its last word', () => {
    for (const line of [
      'cp -t /elsewhere a.ts',
      'cp --target-directory=/elsewhere a.ts',
      'cp --target-directory /elsewhere a.ts',
      'cp --tar=/elsewhere a.ts',
      'cp -rt /elsewhere a.ts',
      'install -Dt /elsewhere a.ts',
      'mv -t /elsewhere a.ts',
      'cp a.ts > /dev/null /elsewhere',
    ])
      assert.deepInclude(verdictOf(line), { verdict: 'ask', reason: "Writing outside the task's worktree always asks: /elsewhere" }, line)
    assert.deepInclude(verdictOf('cp -r -- a.ts /elsewhere/'), { verdict: 'ask' })
    for (const line of ['cp a.ts b.ts', 'cp -t dist a.ts']) assert.strictEqual(verdictOf(line).verdict, 'allow', line)
  })

  it('is what xargs runs, past its own options: asked about where Althar can’t tell what it acts on', () => {
    assert.deepInclude(verdictOf('ls | xargs rm'), {
      verdict: 'ask',
      reason: "Althar can't tell what `xargs rm` acts on until it runs, so it asks.",
    })
    for (const line of ['ls | xargs -n 1 -I {} rm /elsewhere/{}', 'find . | xargs -0 -- rm -rf /elsewhere'])
      assert.match((verdictOf(line) as { readonly reason: string }).reason, /^Deleting or moving away what's outside/, line)
    for (const line of ['xargs', 'ls | xargs -P 4 cat']) assert.strictEqual(verdictOf(line).verdict, 'allow', line)
  })
})

describe('what a reader may run', () => {
  const cwd = '/work/meridian/.coordinator'
  const said = (line: string) => {
    const decided = decideReader(command(line), { cwd, trusted: true })
    return decided.verdict === 'deny' ? decided.reason : 'allowed'
  }
  const allowed = (lines: ReadonlyArray<string>) => {
    for (const line of lines) assert.strictEqual(said(line), 'allowed', line)
  }

  it('lists tags, but makes, removes or verifies none', () => {
    allowed([
      'git tag',
      'git tag -l "v*"',
      'git tag --list v1',
      'git tag -n5',
      'git tag --sort=-creatordate',
      'git tag --sort -creatordate',
      'git tag --contains HEAD',
    ])
    const named = '`git tag` with a name makes a tag; list them with `git tag -l` and a pattern, as this role only reads.'
    assert.strictEqual(said('git tag v1'), named)
    assert.strictEqual(said('git tag -- v1'), named)
    assert.strictEqual(said('git tag -d v1'), '`git tag -d` makes, removes or verifies a tag, and this role only reads.')
  })

  it('runs awk where its program only prints, from the line', () => {
    allowed(["awk '{print $1}' f", "awk -F, '{print $1}' f", "awk -v x=1 '{print x}' f", "awk -- '{print}' f", "awk '$1 || $2' f"])
    assert.strictEqual(said('awk -f prog.awk f'), '`awk -f` reads its program from a file or loads more, and this role only reads.')
    for (const line of ['awk \'{system("rm x")}\' f', 'awk \'{print > "out"}\' f', 'awk \'{print | "sh"}\' f'])
      assert.match(said(line), /^`awk` may only print what it reads here/, line)
  })

  it('reads a program’s flags, short and long, with their values, and nothing after `--` as one', () => {
    allowed([
      'sort -- -x',
      'sort --reverse f',
      'sort -k 2 f',
      'sort -k2 f',
      'sort -t, -k2 f',
      'sort -rn f',
      'sort -5 f',
      'sort --key=2 f',
      'sort --key 2 f',
    ])
    assert.strictEqual(said('sort --bogus f'), "`sort --bogus` isn't among the flags a reader may use, and this role only reads.")
    assert.strictEqual(said('sort -o out f'), "`sort -o` isn't among the flags a reader may use, and this role only reads.")
    assert.strictEqual(said('sort --output=out f'), "`sort --output` isn't among the flags a reader may use, and this role only reads.")
  })

  it('runs a shell’s script where the system’s shell runs it alone and it only reads', () => {
    allowed(["bash -c 'cat f'", "bash -xc 'cat f'", "sh -c 'cat f' > /dev/null"])
    assert.strictEqual(said("bash -i -c 'cat f'"), '`bash -i` has the shell read or run more than its script, and this role only reads.')
    assert.strictEqual(
      said("bash --norc -c 'cat f'"),
      '`bash --norc` has the shell read or run more than its script, and this role only reads.',
    )
    assert.strictEqual(
      said("./bin/bash -c 'cat f'"),
      "`./bin/bash` runs what that folder holds, not the system's `bash`, and this role only reads.",
    )
    assert.strictEqual(said("bash -c 'cat f > out'"), 'It would write to out, and this role only reads.')
  })
})

describe('a cmd or PowerShell command on Windows', () => {
  const home = 'C:\\Users\\alice'
  const windows: RuleContext = {
    ...context,
    worktree: `${home}\\Althar\\meridian\\retry\\app`,
    platform: 'win32',
    home,
    realPath: (path) => {
      if (/[/\\]\.git$/.test(path)) throw new Error('ENOENT')
      return path
    },
    scratch: [],
    project: { mode: 'rules', ask: ['outside'], never: [], allow: [], commands: [] },
  }
  const reasonOf = (line: string) => {
    const decided = decide(command(line), windows)
    return decided.verdict === 'allow' ? 'allowed' : (decided as { readonly reason: string }).reason
  }
  const writes = (path: string) => `Writing outside the task's worktree always asks: ${path}`
  const movesAway = (path: string) =>
    `Deleting or moving away what's outside the task's worktree always asks: it could be someone's only copy: ${path}`

  it('reads a move or a rename by its parameters or their places, and asks where it takes from or goes outside', () => {
    for (const line of ['move a.txt b.txt', 'mi a.txt', 'Rename-Item -Path a.txt -NewName b.txt', 'ren a.txt b.txt'])
      assert.strictEqual(reasonOf(line), 'allowed', line)
    assert.strictEqual(reasonOf('Move-Item -Path a.txt -Destination D:\\elsewhere'), writes('D:/elsewhere'))
    assert.strictEqual(reasonOf('mv a.txt D:\\elsewhere'), writes('D:/elsewhere'))
    assert.strictEqual(reasonOf('Rename-Item D:\\elsewhere\\a.txt b.txt'), movesAway('D:/elsewhere/a.txt'))
    assert.strictEqual(reasonOf('rni -LiteralPath D:\\x\\a.txt -NewName b.txt'), movesAway('D:/x/a.txt'))
    assert.strictEqual(reasonOf('rename D:\\x\\a.txt'), movesAway('D:/x/a.txt'))
  })

  it('reads robocopy’s mirror as deleting where it copies to, and its move as taking from where it copies from', () => {
    assert.strictEqual(reasonOf('robocopy src D:\\backup /MIR'), movesAway('D:/backup'))
    assert.strictEqual(reasonOf('robocopy D:\\x src /MOVE'), movesAway('D:/x'))
  })

  it('reads what writes a file, by its path given or its first place', () => {
    for (const [line, path] of [
      ['Set-Content -Path D:\\x\\a.txt -Value hi', 'D:/x/a.txt'],
      ['Out-File D:\\x\\log.txt -Append', 'D:/x/log.txt'],
      ['New-Item -Force D:\\x\\n.txt', 'D:/x/n.txt'],
      ['ni D:\\x\\n.txt', 'D:/x/n.txt'],
    ] as const)
      assert.strictEqual(reasonOf(line), writes(path), line)
  })
})
