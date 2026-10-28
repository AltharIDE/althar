import * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'

import { connect, type PermissionRequest } from '../src/AgentConnection'
import type { Question, QuestionAnswer } from '../src/questions'
import { text } from './contract'

/*
 * An agent that says as little as ACP lets it: a question tied to a request
 * rather than a session, a permission asked for a tool call it never
 * announced, with neither a title nor a kind, and a choice asked with no
 * words for it at all. A small agent of its own, in process, so each ask is
 * exactly what it sends.
 */

const modeOption = (value: string): acp.SessionConfigOption => ({
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: value,
  options: [{ value: 'ask', name: 'Ask' }],
})

const sparseAgent = () => ({
  _tag: 'InProcessAgent' as const,
  app: acp
    .agent({ name: 'sparse-agent' })
    .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'sparse-1', configOptions: [modeOption('ask')] }))
    .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => ({ configOptions: [modeOption(String(params.value))] }))
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const say = (text: string) =>
        client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
        })
      const prompt = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
      if (prompt === 'ask-for-the-request') {
        const answer = await client.request<acp.CreateElicitationResponse, acp.CreateElicitationRequest>(
          acp.methods.client.elicitation.create,
          {
            mode: 'form',
            requestId: 7,
            message: 'Which region?',
            requestedSchema: { type: 'object', properties: { region: { type: 'string', enum: ['eu', 'us'] } } },
          },
        )
        await say(`answer=${answer.action}`)
      } else {
        const toolCallId = prompt === 'choose' ? 'interaction_1' : 'unseen-1'
        const answer = await client.request<acp.RequestPermissionResponse, acp.RequestPermissionRequest>(
          acp.methods.client.session.requestPermission,
          {
            sessionId: params.sessionId,
            toolCall: { toolCallId },
            options: [
              { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
              { optionId: 'no', name: 'No', kind: 'reject_once' },
            ],
          },
        )
        await say(`chosen=${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}`)
      }
      return { stopReason: 'end_turn' }
    }),
})

/** One turn of `prompt` with the sparse agent, the rules and the person answering as given. */
const turn = (
  prompt: string,
  onPermission: (request: PermissionRequest) => Effect.Effect<{ readonly decision: 'allow' | 'reject' }>,
  onQuestion: (question: Question) => Effect.Effect<QuestionAnswer>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* connect({
        transport: { _tag: 'InProcess', agent: sparseAgent() },
        onPermission,
        onQuestion,
        permissions: { rejectAndContinue: ['no'], rejectAndStop: [], allowScopes: {}, questions: 'interaction_' },
      })
      const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
      return text(yield* Stream.runCollect(session.prompt(prompt)))
    }),
  )

describe('an agent that says as little as it can', () => {
  it.live('asks the person a question tied to a request, with no session, tool call or words before it', () =>
    Effect.gen(function* () {
      const seen: Array<Question> = []
      const answered = yield* turn(
        'ask-for-the-request',
        () => Effect.succeed({ decision: 'reject' }),
        (question) => Effect.sync(() => seen.push(question)).pipe(Effect.as({ action: 'decline' as const })),
      )
      assert.strictEqual(answered, 'answer=decline')
      assert.deepStrictEqual(
        seen.map((question) => [question.sessionId, question.toolCallId, question.said, question.message, question.fields[0]?.id]),
        [[undefined, undefined, undefined, 'Which region?', 'region']],
      )
    }),
  )

  it.live('asks the rules about a tool call it never announced, untitled, as one of no kind in particular', () =>
    Effect.gen(function* () {
      const asked: Array<PermissionRequest> = []
      const answered = yield* turn(
        'run',
        (request) => Effect.sync(() => asked.push(request)).pipe(Effect.as({ decision: 'allow' as const })),
        () => Effect.succeed({ action: 'cancel' }),
      )
      assert.strictEqual(answered, 'chosen=yes')
      assert.deepInclude(asked[0], { sessionId: 'sparse-1', toolCallId: 'unseen-1', title: '', kind: 'other' })
    }),
  )

  it.live('asks the person to choose in words of its own where the agent gives none for the choice', () =>
    Effect.gen(function* () {
      const seen: Array<Question> = []
      const answered = yield* turn(
        'choose',
        () => Effect.die('the rules are never asked a question'),
        (question) => Effect.sync(() => seen.push(question)).pipe(Effect.as({ action: 'accept' as const, content: { answer: 'no' } })),
      )
      assert.strictEqual(answered, 'chosen=no')
      assert.deepStrictEqual(
        seen.map((question) => [question.message, question.fields[0]?.question, question.fields[0]?.options]),
        [
          [
            'The agent asks you to choose.',
            'The agent asks you to choose.',
            [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ],
          ],
        ],
      )
    }),
  )
})
