import { Effect } from 'effect'

import type { CodeRoots } from './code'
import { gitExactly } from './git'

/** Names from the same roots OpenCode uses: a task's worktree, or the
 * project's default branch. Git runs asynchronously, outside the UI thread. */
export const searchFiles = (place: CodeRoots) =>
  Effect.gen(function* () {
    const files = yield* Effect.forEach(
      place.roots,
      (root) =>
        Effect.gen(function* () {
          const text =
            root.commit === null
              ? yield* gitExactly(root.path, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
              : yield* gitExactly(root.path, 'ls-tree', '-r', '--name-only', '-z', root.commit)
          return text
            .split('\0')
            .filter((path) => path !== '' && (root.within === null || path.startsWith(`${root.within}/`)))
            .map((path) => (place.roots.length > 1 ? `${root.slug}/${path}` : path))
        }),
      { concurrency: 2 },
    )
    return { files: [...new Set(files.flat())] }
  })
