import type { AlwaysScope, HomeCall } from '@althar/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Lock } from 'iconoir-react-native'
import { useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'

import { useCommand, useConnection, useHome, useNow } from '../../client/react'
import { Button, Card, Text, Well } from '../../components/ui'
import { confirmIsYou, tapDone } from '../../lib/device'
import { callKindOf } from '../../model/calls'
import { agentName, since } from '../../model/words'
import { useTheme } from '../../theme/Theme'
import { fonts, radius, space } from '../../theme/tokens'

/*
 * A call, whole: for a permission, what it would run and why it asks, and
 * every answer the desktop offers (once, always by a scope, deny with what to
 * do instead, never); for a stuck step, what Althar already tried and what
 * the person can do now. Allowing asks for Face ID; denying doesn't.
 */

const scopeWords = (scope: AlwaysScope, call: HomeCall): string => {
  const always = call.always
  switch (scope) {
    case 'exact':
      return 'This exact command'
    case 'prefix':
      return always?.prefix == null ? 'Commands like it' : `Every \`${always.prefix} …\``
    case 'kind':
      return always?.kind == null ? 'Everything of its kind' : `Every ${always.kind.replace(/-/g, ' ')}`
  }
}

function Permission({ call }: { readonly call: HomeCall }) {
  const router = useRouter()
  const theme = useTheme()
  const reachable = useConnection().state === 'online'
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const answer = useCommand(
    (client, input: { readonly decision: 'allow' | 'reject'; readonly always?: AlwaysScope; readonly reason?: string }) =>
      client.answer({ attentionId: call.id, ...input }),
  )
  const done = { onSuccess: () => (tapDone(), router.back()), onError: (failure: Error) => setError(failure.message) }
  const allow = async (always?: AlwaysScope) => {
    setError(null)
    const proof = await confirmIsYou(always === undefined ? `Allow: ${call.title}` : `Always allow: ${scopeWords(always, call)}`)
    if (!proof.ok) return setError(proof.why)
    answer.mutate({ decision: 'allow', ...(always === undefined ? {} : { always }) }, done)
  }
  return (
    <View style={{ gap: space.lg }}>
      {call.command === null ? null : (
        <Well>
          <Text kind="mono" selectable>
            {call.command}
          </Text>
        </Well>
      )}
      <Text kind="body" ink="t2">
        {call.reason}
      </Text>
      <Button
        label="Allow once"
        tone="signal"
        icon={(color) => <Lock width={16} height={16} color={color} strokeWidth={2} />}
        disabled={!reachable}
        busy={answer.isPending && answer.variables?.decision === 'allow' && answer.variables.always === undefined}
        onPress={() => void allow()}
      />
      {call.held === true ? (
        <Text kind="sub" ink="t3">
          The project always asks about this, so it can’t be allowed always.
        </Text>
      ) : (call.always?.allow.length ?? 0) > 0 ? (
        <Card style={{ gap: space.sm }}>
          <Text kind="label" ink="t3">
            Always allow, in the project’s rules
          </Text>
          {call.always?.allow.map((scope) => (
            <Button key={scope} label={scopeWords(scope, call)} tone="plain" small disabled={!reachable} onPress={() => void allow(scope)} />
          ))}
        </Card>
      ) : null}
      <Card style={{ gap: space.sm }}>
        <Text kind="label" ink="t3">
          Deny
        </Text>
        <TextInput
          accessibilityLabel="What to do instead"
          value={note}
          onChangeText={setNote}
          placeholder="What to do instead (optional)"
          placeholderTextColor={theme.t4}
          multiline
          style={{
            minHeight: 44,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.line3,
            backgroundColor: theme.paper,
            color: theme.t1,
            padding: space.md,
            fontFamily: fonts.regular,
            fontSize: 15,
          }}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Deny"
            tone="danger"
            grow
            disabled={!reachable}
            onPress={() => answer.mutate({ decision: 'reject', ...(note.trim() === '' ? {} : { reason: note.trim() }) }, done)}
          />
          {(call.always?.deny.length ?? 0) > 0 ? (
            <Button
              label="Never"
              tone="danger"
              grow
              accessibilityHint="Denies it, and keeps denying this exact command in the project’s rules"
              disabled={!reachable}
              onPress={() => answer.mutate({ decision: 'reject', always: call.always?.deny[0] ?? 'exact' }, done)}
            />
          ) : null}
        </View>
      </Card>
      {error === null ? null : (
        <Text kind="sub" ink="danger">
          {error}
        </Text>
      )}
    </View>
  )
}

const triedWords = { carried_on: 'told the agent to carry on', restarted: 'started it afresh', redirected: 'told it to try another way' } as const

function Stuck({ call }: { readonly call: HomeCall }) {
  const router = useRouter()
  const theme = useTheme()
  const reachable = useConnection().state === 'online'
  const [note, setNote] = useState('')
  const answer = useCommand((client, input: Parameters<typeof client.answerStuck>[0]['answer']) => client.answerStuck({ attentionId: call.id, answer: input }))
  const done = { onSuccess: () => (tapDone(), router.back()) }
  const stuck = call.stuck
  const other = stuck?.agentId === 'codex' ? 'claude-code' : 'codex'
  return (
    <View style={{ gap: space.lg }}>
      {stuck?.detail == null ? null : <Text kind="body">{stuck.detail}</Text>}
      {stuck?.tried === undefined || stuck.tried.length === 0 ? null : (
        <Text kind="sub" ink="t3">
          Althar already {stuck.tried.map((one) => triedWords[one]).join(', then ')}.
        </Text>
      )}
      <Card style={{ gap: space.sm }}>
        <Text kind="label" ink="t3">
          Tell the lead what to do
        </Text>
        <TextInput
          accessibilityLabel="What the lead should do"
          value={note}
          onChangeText={setNote}
          placeholder="Take one more round on the export errors; leave the cap for later."
          placeholderTextColor={theme.t4}
          multiline
          style={{
            minHeight: 64,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.line3,
            backgroundColor: theme.paper,
            color: theme.t1,
            padding: space.md,
            fontFamily: fonts.regular,
            fontSize: 15,
          }}
        />
        <Button label="Send to the lead" tone="signal" disabled={!reachable || note.trim() === ''} onPress={() => answer.mutate({ kind: 'tell', note: note.trim() }, done)} />
      </Card>
      <Button label={`Hand it to ${agentName(other)}`} tone="plain" disabled={!reachable} onPress={() => answer.mutate({ kind: 'retry', agentId: other }, done)} />
      {stuck?.why === 'usage_limit' ? <Button label="Wait for the reset" tone="plain" disabled={!reachable} onPress={() => answer.mutate({ kind: 'wait' }, done)} /> : null}
      <Button label="Abandon the task" tone="danger" disabled={!reachable} onPress={() => answer.mutate({ kind: 'abandon' }, done)} />
    </View>
  )
}

export default function CallSheet() {
  const { callId } = useLocalSearchParams<{ callId: string }>()
  const router = useRouter()
  const now = useNow()
  const home = useHome()
  const call = home.data?.calls.find((one) => one.id === callId)
  const project = home.data?.projects.find((one) => one.id === call?.projectId)
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      {call === undefined ? (
        <View style={{ gap: space.md }}>
          <Text kind="headline">{home.data === undefined ? 'Reading…' : 'Already answered'}</Text>
          {home.data === undefined ? null : (
            <>
              <Text kind="sub" ink="t2">
                It was answered, on your Mac or here, or the agent took it back.
              </Text>
              <Button label="Close" tone="plain" onPress={() => router.back()} />
            </>
          )}
        </View>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text kind="label" ink="signal">
              {callKindOf(call)}
            </Text>
            <Text kind="title">{call.title}</Text>
            <Text kind="sub" ink="t3">
              {[project?.name, call.taskTitle ?? 'Coordinator', since(call.createdAt, now)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {call.kind === 'permission' ? <Permission call={call} /> : <Stuck call={call} />}
        </>
      )}
    </ScrollView>
  )
}
