/*
 * A tool's input as Althar serves it, in the JSON Schema every agent's model takes. Gemini's function declarations take one
 * `type` per schema, never a list: `type: ['object', 'null']` with `properties` is refused, and the whole request with it
 * ("properties: only allowed for OBJECT type"), so a Gemini lead or reviewer with Althar's tools failed on its first turn.
 * OpenCode passes such a list through to Gemini's providers as it is. So a list is served as `anyOf`, one branch for each of
 * its types, each with one `type`: the same values allowed, to every JSON Schema client (null still where it was), in a form
 * Gemini takes. What belongs to one type (an object's properties, a string's enum) goes in that type's branch; what describes
 * the whole (its description, title, default) stays beside `anyOf`.
 */

type Json = unknown

/** Keywords that describe the value whatever its type, kept beside `anyOf` rather than in each branch. */
const WHOLE = new Set(['description', 'title', 'default', 'examples', 'deprecated'])

/** Keywords that hold for only one of a list's types, as JSON Schema applies them: each goes only in its type's branch. */
const OWN: Readonly<Record<string, ReadonlyArray<string>>> = {
  object: ['properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties'],
  array: ['items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'contains'],
  string: ['minLength', 'maxLength', 'pattern', 'format'],
  number: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
  integer: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
}
const OWNED = new Set(Object.values(OWN).flat())

const ofType = (value: unknown, type: string) =>
  type === 'integer'
    ? Number.isInteger(value)
    : type === 'array'
      ? Array.isArray(value)
      : type === 'object'
        ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : typeof value === type

/** The schema with every `type` list made `anyOf` branches of one type each; everything else as it was. */
export const singleTypes = (schema: Json): Json => {
  if (Array.isArray(schema)) return schema.map(singleTypes)
  if (schema === null || typeof schema !== 'object') return schema
  const node = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, singleTypes(value)]))
  const listed: unknown = node.type
  if (!Array.isArray(listed)) return node
  const types = listed.filter((type): type is string => typeof type === 'string')
  if (types.length === 1) return { ...node, type: types[0] }
  const whole = Object.fromEntries(Object.entries(node).filter(([key]) => WHOLE.has(key)))
  const shared = Object.entries(node).filter(([key]) => key !== 'type' && !WHOLE.has(key) && !OWNED.has(key))
  // An enum keeps, in each branch, its values of that branch's type.
  const branch = (type: string) => ({
    type,
    ...Object.fromEntries(
      type === 'null'
        ? []
        : [
            ...shared.map(([key, value]) =>
              key === 'enum' && Array.isArray(value) ? [key, value.filter((one) => ofType(one, type))] : [key, value],
            ),
            ...Object.entries(node).filter(([key]) => OWN[type]?.includes(key)),
          ],
    ),
  })
  return { ...whole, anyOf: types.map(branch) }
}
