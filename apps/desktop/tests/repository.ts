import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A git repository called `meridian` with one commit on `main`, in a folder of its own. */
export const repository = (under = mkdtempSync(join(tmpdir(), 'charrette-desktop-'))) => {
  const path = join(under, 'meridian')
  mkdirSync(path)
  const git = (...args: Array<string>) =>
    execFileSync('git', args, {
      cwd: path,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@charrette.test',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@charrette.test',
      },
    })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# Meridian\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Start')
  return path
}
