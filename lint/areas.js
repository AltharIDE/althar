import { defineRule } from 'vite-plus/lint/plugins'

/*
 * A call to the API is made in its area (AGENTS.md, "Where a change goes"): its schemas and RPC in the contract's
 * `packages/contracts/src/api/<area>.ts`, its handler in the runtime's `packages/runtime/src/api/<area>.ts`. Each
 * package's `Api.ts` only puts the areas together, the contract's merging their groups and the runtime's spreading
 * their handlers, so a new call changes its area alone and two in flight don't meet in one file. This rule, set on the
 * two `Api.ts`, refuses a call defined there, and a handler written there instead of spread from its area.
 */

/** The ways the contract makes an RPC or a group of them: Effect's, and its own `call` and `command`. */
const isDefinition = (callee) =>
  (callee.type === 'Identifier' && (callee.name === 'call' || callee.name === 'command')) ||
  (callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    (callee.object.name === 'Rpc' || callee.object.name === 'RpcGroup') &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'make')

/** `ApiHandlers` or `Partial<ApiHandlers>`: what a set of handlers is checked as. */
const isHandlers = (type) =>
  type.type === 'TSTypeReference' &&
  type.typeName.type === 'Identifier' &&
  (type.typeName.name === 'ApiHandlers' ||
    (type.typeName.name === 'Partial' &&
      (type.typeArguments ?? type.typeParameters)?.params?.some(
        (param) => param.type === 'TSTypeReference' && param.typeName.type === 'Identifier' && param.typeName.name === 'ApiHandlers',
      )))

export const callsInAreas = defineRule({
  meta: {
    type: 'problem',
    messages: {
      defined:
        "A call is made in its area's module, packages/contracts/src/api/<area>.ts, with its schemas: Api.ts only merges the areas' groups.",
      handled:
        "A call's handler goes in its area's module, packages/runtime/src/api/<area>.ts, on the kit's helpers: Api.ts only spreads the areas' handlers.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isDefinition(node.callee)) context.report({ node, messageId: 'defined' })
      },
      TSSatisfiesExpression(node) {
        if (!isHandlers(node.typeAnnotation) || node.expression.type !== 'ObjectExpression') return
        for (const member of node.expression.properties)
          if (member.type !== 'SpreadElement') context.report({ node: member, messageId: 'handled' })
      },
    }
  },
})
