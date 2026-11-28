import { Schema, SchemaAST, SchemaGetter, SchemaTransformation } from 'effect'

/*
 * What a client makes of what a newer home says (docs/decisions/foundations.md,
 * "Clients of another version"). A home and its clients ship apart, so a home
 * can send a member of a union that a client built before it doesn't know: a
 * notice's role, an item's kind, an event. That would fail the whole answer.
 * An open union decodes a member it doesn't know as its fallback instead, and
 * a known list leaves one out where nothing could show it. Encoding stays
 * strict: a runtime sends only the members listed, never the fallback.
 */

const notOneOf = (known: ReadonlyArray<string>) =>
  Schema.makeFilter<string>((value) => !known.includes(value), {
    expected: `none of ${known.join(', ')}`,
    toJsonSchema: () => ({ not: { enum: [...known] } }),
  })

const neverSent = (fallback: string) =>
  SchemaGetter.forbidden<never, unknown>(() => `"${fallback}" is what a client makes of a member it doesn't know, and is never sent`)

/** Literals a newer home may add to: one this client doesn't know decodes as `fallback`. */
export const OpenLiterals = <const L extends ReadonlyArray<string>, const F extends string>(literals: L, fallback: F) =>
  Schema.Union([
    Schema.Literals(literals),
    Schema.String.check(notOneOf(literals)).pipe(
      Schema.decodeTo(Schema.Literal(fallback), { decode: SchemaGetter.succeed(fallback), encode: neverSent(fallback) }),
    ),
  ])

/** What tells structs apart: the literals each says for `key`. */
const tagsOf = (key: string, members: ReadonlyArray<Schema.Top>): ReadonlyArray<string> =>
  members.flatMap((member) => {
    const field = SchemaAST.isObjects(member.ast)
      ? member.ast.propertySignatures.find((property) => property.name === key)?.type
      : undefined
    const literals = field === undefined ? [] : SchemaAST.isUnion(field) ? field.types : [field]
    const tags = literals.flatMap((literal) =>
      SchemaAST.isLiteral(literal) && typeof literal.literal === 'string' ? [literal.literal] : [],
    )
    if (tags.length === 0) throw new Error(`Each member of an open union says its ${key} as a literal.`)
    return tags
  })

/** What an open union of structs told apart by `K` decodes, and what it takes: one of its members, or one it doesn't know. */
type Decoded<M extends ReadonlyArray<Schema.Top>, K extends string, F extends string> = M[number]['Type'] | { readonly [P in K]: F }
type Taken<M extends ReadonlyArray<Schema.Top>, K extends string> = M[number]['Encoded'] | { readonly [P in K]: string }

/*
 * TypeScript can't follow a struct's type through a key it is given, so each
 * of these says in its signature what it decodes, from what; below it is
 * built of schemas alone, and what it decodes is the members' own decoding.
 */

/** Structs told apart by `key`, which a newer home may add to: one whose `key` this client doesn't know decodes as `{ [key]: fallback }`. */
export function OpenUnion<const K extends string, const M extends ReadonlyArray<Schema.Top>, const F extends string>(
  key: K,
  members: M,
  fallback: F,
): Schema.Codec<Decoded<M, K, F>, Taken<M, K>>
export function OpenUnion(key: string, members: ReadonlyArray<Schema.Top>, fallback: string): Schema.Top {
  const tags = tagsOf(key, members)
  if (tags.includes(fallback)) throw new Error(`An open union's fallback, ${fallback}, is none of its members.`)
  return Schema.Union([
    ...members,
    Schema.Struct({ [key]: Schema.String.check(notOneOf(tags)) }).pipe(
      Schema.decodeTo(Schema.Struct({ [key]: Schema.Literal(fallback) }), {
        decode: SchemaGetter.succeed({ [key]: fallback }),
        encode: neverSent(fallback),
      }),
    ),
  ])
}

const UNKNOWN = 'unknown'

/** Whether the open union decoded a member this client knows: `key` alone tells one from the fallback. */
const knownOf = (key: string, members: ReadonlyArray<Schema.Top>) => {
  const tags = tagsOf(key, members)
  return (value: unknown): boolean => typeof value === 'object' && value !== null && tags.includes(Reflect.get(value, key))
}

/**
 * A list of structs told apart by `key`, without those this client doesn't
 * know: where one can't be shown, as an item of a thread it can't draw, it is
 * left out, as an item the thread keeps for Althar is.
 */
export function KnownArray<const K extends string, const M extends ReadonlyArray<Schema.Top>>(
  key: K,
  members: M,
): Schema.Codec<ReadonlyArray<M[number]['Type']>, ReadonlyArray<Taken<M, K>>>
export function KnownArray(key: string, members: ReadonlyArray<Schema.Top>): Schema.Top {
  const known = knownOf(key, members)
  return Schema.Array(OpenUnion(key, members, UNKNOWN)).pipe(
    Schema.decodeTo(
      Schema.Array(Schema.Unknown),
      SchemaTransformation.transform<ReadonlyArray<unknown>, ReadonlyArray<unknown>>({
        decode: (values) => values.filter(known),
        encode: (values) => values,
      }),
    ),
  )
}

/** One of structs told apart by `key`, or null: null too for one this client doesn't know, which it can't show. */
export function KnownOrNull<const K extends string, const M extends ReadonlyArray<Schema.Top>>(
  key: K,
  members: M,
): Schema.Codec<M[number]['Type'] | null, Taken<M, K> | null>
export function KnownOrNull(key: string, members: ReadonlyArray<Schema.Top>): Schema.Top {
  const known = knownOf(key, members)
  return Schema.NullOr(OpenUnion(key, members, UNKNOWN)).pipe(
    Schema.decodeTo(
      Schema.Unknown,
      SchemaTransformation.transform({ decode: (value) => (known(value) ? value : null), encode: (value) => value }),
    ),
  )
}
