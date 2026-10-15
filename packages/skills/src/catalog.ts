import { z } from 'zod'

const SHA = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{64}$/

/** Where a catalog entry came from: a pinned commit of a GitHub repository, or Althar's own source tree. */
const Source = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('github'),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    sha: z.string().regex(SHA),
    subpath: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('althar') }),
])

const Entry = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
  source: Source,
  /** The hash of the files as the store holds them, patch applied. */
  treeHash: z.string().regex(HASH),
  /** The hash of the upstream tree before any patch, so a re-vendor can tell upstream changed. */
  upstreamTreeHash: z.string().regex(HASH).optional(),
  license: z.string().min(1),
  copyright: z.string().min(1).optional(),
  /** Capabilities a harness must have for the skill to make sense there. */
  needs: z.array(z.enum(['subagents'])).default([]),
  /** The named patch applied to the upstream copy, if any. */
  patch: z.string().min(1).optional(),
  note: z.string().default(''),
})

const Catalog = z.strictObject({
  version: z.literal(1),
  /** The catalog's own revision, shown in the app and used by the update check. */
  revision: z.string().min(1),
  entries: z.array(Entry),
})

export type CatalogEntry = z.infer<typeof Entry>
export type Catalog = z.infer<typeof Catalog>

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** Reads a catalog from its JSON text: a shape error or a repeated id is a refusal, not a guess. */
export const parseCatalog = (text: string): Parsed<Catalog> => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the catalog is not JSON' }
  }
  const result = Catalog.safeParse(json)
  if (!result.success)
    return { ok: false, error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
  const ids = new Set<string>()
  for (const { id } of result.data.entries) {
    if (ids.has(id)) return { ok: false, error: `the id "${id}" appears twice` }
    ids.add(id)
  }
  return { ok: true, value: result.data }
}
