/*
 * Builds the default catalog (`catalog/`) from clones of its upstream repositories, as `curation.ts` says:
 *
 *   node packages/skills/scripts/vendor.ts --agent-skills <clone> --superpowers <clone>
 *
 * Each clone must be at the pinned commit. Only `skills/<id>/` and the reference files a skill links are read; nothing
 * in a clone is run. The skills are written with their patches applied, with each upstream's licence and a
 * THIRD_PARTY.md, and catalog.json pins every tree's hash. The package's tests then load the catalog as the app does.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { treeHash } from '../src/hash.ts'
import { looksExecutable } from '../src/executable.ts'
import { CURATED, type Curated, EVERYWHERE, LEFT_OUT, ROOT_REFERENCES, UPSTREAMS, type UpstreamName } from './curation.ts'

const { values } = parseArgs({ options: { 'agent-skills': { type: 'string' }, superpowers: { type: 'string' }, out: { type: 'string' } } })
const clones: Record<UpstreamName, string> = {
  'agent-skills': values['agent-skills'] ?? fail('--agent-skills <clone> is required'),
  superpowers: values.superpowers ?? fail('--superpowers <clone> is required'),
}
const out = values.out ?? join(dirname(new URL(import.meta.url).pathname), '..', 'catalog')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

for (const [name, clone] of Object.entries(clones) as Array<[UpstreamName, string]>) {
  // Read only: no hook or config of the clone's runs for rev-parse.
  const head = execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== UPSTREAMS[name].sha) fail(`${name} is at ${head}, not the pinned ${UPSTREAMS[name].sha}`)
}

/** A skill directory's plain files, refusing a symlink or anything else that isn't one. */
const readTree = (base: string): Map<string, Buffer> => {
  const files = new Map<string, Buffer>()
  const walk = (relative: string) => {
    for (const name of readdirSync(join(base, relative))) {
      const path = relative === '' ? name : `${relative}/${name}`
      const stat = lstatSync(join(base, path))
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) files.set(path, readFileSync(join(base, path)))
      else fail(`${base}/${path} is not a plain file`)
    }
  }
  walk('')
  return files
}

const encode = (files: ReadonlyMap<string, Buffer>) => new Map([...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]))

const isText = (path: string) => !/\.(png|jpe?g|gif|webp|ico|pdf)$/i.test(path)

const patched = (skill: Curated) => {
  const upstream = readTree(join(clones[skill.from], 'skills', skill.id))
  const files = new Map(upstream)
  for (const path of skill.drop ?? []) {
    if (!files.delete(path)) fail(`${skill.id}: ${path} to drop is not there`)
  }
  for (const [path, from] of Object.entries(skill.add ?? {})) {
    if (files.has(path)) fail(`${skill.id}: ${path} to add is already there`)
    files.set(path, readFileSync(join(clones[skill.from], from)))
  }
  for (const edit of skill.edits ?? []) {
    const text = files.get(edit.file)?.toString('utf8') ?? fail(`${skill.id}: ${edit.file} to edit is not there`)
    const count = text.split(edit.find).length - 1
    if (count === 0 || (count > 1 && edit.all !== true))
      fail(`${skill.id}: ${edit.file} has ${count} of ${JSON.stringify(edit.find.slice(0, 80))}`)
    files.set(edit.file, Buffer.from(text.replaceAll(edit.find, edit.replace)))
  }
  // The root reference files a skill links, carried into its own references/ (a copy: the loop adds to the map).
  for (const [path, bytes] of Array.from(files)) {
    if (!isText(path)) continue
    for (const [, name] of bytes.toString('utf8').matchAll(/(?:\.\.\/){2,3}references\/([a-z-]+)\.md/g)) {
      if (!ROOT_REFERENCES.includes(name!)) fail(`${skill.id}: ${path} links the root reference ${name}, which is not carried`)
      const target = `references/${name}.md`
      if (!files.has(target)) files.set(target, readFileSync(join(clones[skill.from], 'references', `${name}.md`)))
    }
  }
  for (const [path, bytes] of files) {
    if (!path.endsWith('.md')) continue
    let text = bytes.toString('utf8')
    for (const { pattern, replace } of EVERYWHERE[skill.from]) text = text.replace(pattern, replace)
    files.set(path, Buffer.from(text))
  }
  return { upstream, files }
}

// What this writes, replaced whole; CURATION.md beside it is written by hand.
for (const generated of ['skills', 'LICENSES', 'catalog.json', 'THIRD_PARTY.md'])
  rmSync(join(out, generated), { recursive: true, force: true })
mkdirSync(join(out, 'skills'), { recursive: true })
const ids = new Set(CURATED.map(({ id }) => id))
const problems: string[] = []
const entries = []
for (const skill of CURATED) {
  const { upstream, files } = patched(skill)
  for (const [path, bytes] of files) {
    const target = join(out, 'skills', skill.id, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes, { mode: looksExecutable(path) ? 0o755 : 0o644 })
    if (!path.endsWith('.md')) continue
    const text = bytes.toString('utf8')
    // A link to a sibling skill must name one the catalog carries, and one a harness gets whenever it gets this one.
    for (const [, sibling] of text.matchAll(/\.\.\/([a-z0-9-]+)\//g)) {
      const other = CURATED.find(({ id }) => id === sibling)
      if (other === undefined) problems.push(`${skill.id}/${path} links ../${sibling}/, which the catalog does not carry`)
      else if ((other.needs ?? []).some((need) => !(skill.needs ?? []).includes(need)))
        problems.push(`${skill.id}/${path} links ../${sibling}/, which a harness without ${other.needs?.join(', ')} is not given`)
    }
    for (const left of Object.keys(LEFT_OUT)) {
      const name = left.split('@')[0]!
      if (!ids.has(name) && new RegExp(`\\b${name}\\b`).test(text)) problems.push(`${skill.id}/${path} names ${name}, which is left out`)
    }
  }
  const upstreamName = UPSTREAMS[skill.from]
  entries.push({
    id: skill.id,
    source: { kind: 'github', repo: upstreamName.repo, sha: upstreamName.sha, subpath: `skills/${skill.id}` },
    treeHash: treeHash(encode(files)),
    upstreamTreeHash: treeHash(encode(upstream)),
    license: upstreamName.license,
    copyright: upstreamName.copyright,
    needs: [...(skill.needs ?? [])],
    ...(treeHash(encode(files)) === treeHash(encode(upstream)) ? {} : { patch: `althar/${skill.id}` }),
    note: skill.note,
  })
}

mkdirSync(join(out, 'LICENSES'), { recursive: true })
for (const [name, clone] of Object.entries(clones) as Array<[UpstreamName, string]>) {
  writeFileSync(join(out, 'LICENSES', `${name}.txt`), readFileSync(join(clone, 'LICENSE')))
}
const revision = `${UPSTREAMS['agent-skills'].sha.slice(0, 8)}-${UPSTREAMS.superpowers.sha.slice(0, 8)}`
writeFileSync(join(out, 'catalog.json'), `${JSON.stringify({ version: 1, revision, entries }, null, 2)}\n`)
const lines = [
  '# Third-party skills in the default catalog',
  '',
  'Generated by `scripts/vendor.ts` from `scripts/curation.ts`; do not edit by hand. Each upstream’s licence is in `LICENSES/`.',
  'A skill with a patch is a modified copy: `scripts/curation.ts` has the patch, `CURATION.md` says why.',
  '',
]
for (const [name, upstream] of Object.entries(UPSTREAMS) as Array<[UpstreamName, (typeof UPSTREAMS)[UpstreamName]]>) {
  lines.push(
    `## ${upstream.repo}`,
    '',
    `- Licence: ${upstream.license}, \`LICENSES/${name}.txt\``,
    `- ${upstream.copyright}`,
    `- Commit: \`${upstream.sha}\``,
    '',
  )
  for (const entry of entries.filter((candidate) => candidate.source.repo === upstream.repo))
    lines.push(`- \`${entry.id}\`${entry.patch === undefined ? '' : ' (modified)'}: ${entry.note}`)
  lines.push('')
}
writeFileSync(join(out, 'THIRD_PARTY.md'), lines.join('\n'))
if (problems.length > 0) fail(`The catalog was written, but:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
process.stdout.write(`${entries.length} skills, revision ${revision}, in ${out}\n`)
