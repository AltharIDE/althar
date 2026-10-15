import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/*
 * The workspace patches Claude Code's adapter (the repository's `patches/`,
 * applied by bun), so a rate-limit event is sent even before a turn's first
 * usage figure (claude-agent-acp #1127). The packaged app's adapters are
 * npm's, which knows nothing of bun's patches, so packaging applies the same
 * patch to its copy, and checks that it took.
 */

/** A line the patch adds, by which a copy of the adapter is known to be patched. */
export const ADAPTER_PATCH_MARKER = 'Althar: the event is sent'

/** The file of the adapter the patch changes, from the adapter's folder. */
export const PATCHED_FILE = join('dist', 'acp-agent.js')

/** The repository's patch for the adapter at this version. */
export const adapterPatchFor = (repository: string, version: string | undefined) => {
  if (version === undefined) throw new Error('The app does not depend on the Claude adapter, so there is nothing to patch')
  return join(repository, 'patches', `@agentclientprotocol%2Fclaude-agent-acp@${version}.patch`)
}

/** Fails unless the adapter in this folder has the patch. */
export const assertAdapterPatched = (adapterDir: string) => {
  const file = join(adapterDir, PATCHED_FILE)
  if (!existsSync(file)) throw new Error(`The Claude adapter has no ${file}`)
  if (!readFileSync(file, 'utf8').includes(ADAPTER_PATCH_MARKER))
    throw new Error(`The Claude adapter at ${adapterDir} is not patched: ${file} lacks “${ADAPTER_PATCH_MARKER}”`)
}

/**
 * Applies the patch to the adapter in this folder. Git is kept from finding
 * a repository above it: inside one, as the staged app is under
 * apps/desktop/out, `git apply` takes the patch's paths from that
 * repository's top, skips every file outside the folder it runs in, and
 * still succeeds, leaving the adapter as it was.
 */
export const applyAdapterPatch = (adapterDir: string, patch: string) => {
  if (!existsSync(patch)) throw new Error(`There is no patch for the Claude adapter at ${patch}: make it again for this version`)
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(adapterDir) }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  execFileSync('git', ['apply', patch], { cwd: adapterDir, stdio: 'inherit', env })
  assertAdapterPatched(adapterDir)
}
