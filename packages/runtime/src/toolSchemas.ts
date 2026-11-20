/*
 * A tool's input as Althar serves it, in the JSON Schema every agent's model takes. Gemini's function declarations take one
 * `type` per schema, never a list: `type: ['object', 'null']` with `properties` is refused, and the whole request with it
 * ("properties: only allowed for OBJECT type"), so a Gemini lead or reviewer with Althar's tools fails on its first turn.
 * OpenCode passes such a list through to Gemini's providers as it is. So a list is served as its one type, the first that
 * isn't null (Google's own conversion picks the same), with `nullable: true` where null was in it: what Gemini reads as null
 * allowed, and what Claude's and OpenAI's models read as the same. Tools still define their inputs with lists, and still take
 * null where they did: nothing checks a call's input against what was listed.
 */

type Json = unknown

/** The schema with every `type` list made one type, `nullable: true` where null was in it; everything else as it was. */
export const singleTypes = (schema: Json): Json => {
  if (Array.isArray(schema)) return schema.map(singleTypes)
  if (schema === null || typeof schema !== 'object') return schema
  const node = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, singleTypes(value)]))
  const listed: unknown = (schema as { type?: unknown }).type
  if (!Array.isArray(listed)) return node
  const types = listed.filter((type): type is string => typeof type === 'string' && type !== 'null')
  const nullable = listed.includes('null')
  // A number or a link, as a pull request is named: a string carries either, and every such tool reads a string.
  const type = types.length === 0 ? 'null' : types.length > 1 && types.includes('string') ? 'string' : types[0]
  return { ...node, type, ...(nullable && type !== 'null' ? { nullable: true } : {}) }
}
