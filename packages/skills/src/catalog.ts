import { Effect, Schema } from 'effect'
import { SkillStoreFailed } from './errors'

const SHA = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{64}$/

/** Text that says something. */
const Text = Schema.String.check(Schema.isMinLength(1))

/** Where a catalog entry came from: a pinned commit of a GitHub repository, or Althar's own source tree. */
const Source = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('github'),
    repo: Schema.String.check(Schema.isPattern(/^[\w.-]+\/[\w.-]+$/)),
    sha: Schema.String.check(Schema.isPattern(SHA)),
    subpath: Text,
  }),
  Schema.Struct({ kind: Schema.Literal('althar') }),
])

const Entry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), Schema.isMaxLength(64)),
  source: Source,
  /** The hash of the files as the store holds them, patch applied. */
  treeHash: Schema.String.check(Schema.isPattern(HASH)),
  /** The hash of the upstream tree before any patch, so a re-vendor can tell upstream changed. */
  upstreamTreeHash: Schema.optionalKey(Schema.String.check(Schema.isPattern(HASH))),
  license: Text,
  copyright: Schema.optionalKey(Text),
  /** Capabilities a harness must have for the skill to make sense there. */
  needs: Schema.Array(Schema.Literal('subagents')).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** The named patch applied to the upstream copy, if any. */
  patch: Schema.optionalKey(Text),
  note: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(''))),
})

const Catalog = Schema.Struct({
  version: Schema.Literal(1),
  /** The catalog's own revision, shown in the app and used by the update check. */
  revision: Text,
  entries: Schema.Array(Entry),
})

export type CatalogEntry = typeof Entry.Type
export type Catalog = typeof Catalog.Type

const decodeCatalog = Schema.decodeUnknownEffect(Catalog, { onExcessProperty: 'error' })

/** JSON text as a value, or why it isn't JSON. */
export const parseJson = (text: string, what: string): Effect.Effect<unknown, SkillStoreFailed> =>
  Effect.try({ try: (): unknown => JSON.parse(text), catch: () => new SkillStoreFailed({ message: `${what} is not JSON` }) })

/**
 * Reads a catalog from its JSON text: a shape error or a repeated id is a refusal, not a guess. The catalog is
 * Althar's own, shipped with it, so one that doesn't read is Althar's failure, not the person's.
 */
export const parseCatalog = (text: string): Effect.Effect<Catalog, SkillStoreFailed> =>
  Effect.gen(function* () {
    const catalog = yield* decodeCatalog(yield* parseJson(text, 'the catalog')).pipe(
      Effect.mapError((error) => new SkillStoreFailed({ message: `the catalog does not read: ${error.message}` })),
    )
    const ids = new Set<string>()
    for (const { id } of catalog.entries) {
      if (ids.has(id)) return yield* new SkillStoreFailed({ message: `the id "${id}" appears twice` })
      ids.add(id)
    }
    return catalog
  })
