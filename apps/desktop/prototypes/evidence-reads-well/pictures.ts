// Copies DEV-58's screenshots, left in its lead's temp folder, to where the prototype's server finds them by digest: bun prototypes/evidence-reads-well/pictures.ts
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const from = '/tmp/claude-501/dev58-shots'
const to = join(import.meta.dirname, '../../test-results/evidence-reads-well/pictures')
mkdirSync(to, { recursive: true })
for (const name of ['settings-agents-at-once.png', 'home-waiting.png', 'proto-default.png', 'proto-eleven.png']) {
  const digest = createHash('sha256')
    .update(readFileSync(join(from, name)))
    .digest('hex')
  copyFileSync(join(from, name), join(to, digest))
  console.error(digest, name)
}
