import type { HomeCall, HomeTask, ProjectSummary } from '@althar/contracts'
import { useRouter } from 'expo-router'
import { ChatBubbleQuestion, Check, GitPullRequest, Lock, Pin, Terminal, WarningTriangle } from 'iconoir-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useCommand, useConnection } from '../client/react'
import type { Need } from '../model/home'
import { lines, since, whoWorks } from '../model/words'
import { confirmIsYou, tapDone, tapLight } from '../lib/device'
import { useTheme } from '../theme/Theme'
import { radius, space } from '../theme/tokens'
import { Button, Card, Chip, ProjectMark, Text, Well } from './ui'

/*
 * One thing that needs you, as the home and a project's board show it:
 * answered in place where it can be, with the rest a tap away.
 */

function Where({
  project,
  task,
  at,
  now,
}: {
  readonly project: ProjectSummary | null
  /** The task a call waits in; null for the coordinator's own question; absent for a task's own card. */
  readonly task?: string | null
  readonly at: string
  readonly now: number
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {project === null ? null : <ProjectMark name={project.name} ink={project.ink} size={16} />}
      <Text kind="sub" ink="t3" lines={1} style={{ flexShrink: 1 }}>
        {[project?.name, task === undefined ? null : (task ?? 'Coordinator')].filter(Boolean).join(' · ')}
      </Text>
      <Text kind="sub" ink="t4" style={{ flexShrink: 0 }}>
        · {since(at, now)}
      </Text>
    </View>
  )
}

function Head({ word, icon }: { readonly word: string; readonly icon: (color: string) => React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon(theme.signal)}
      <Text kind="label" ink="signal">
        {word}
      </Text>
    </View>
  )
}

function PermissionCard({
  call,
  word,
  project,
  now,
}: {
  readonly call: HomeCall
  readonly word: string
  readonly project: ProjectSummary | null
  readonly now: number
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const answer = useCommand((client, decision: 'allow' | 'reject') => client.answer({ attentionId: call.id, decision }))
  const reachable = useConnection().state === 'online'
  const allow = async () => {
    setError(null)
    const proof = await confirmIsYou(`Allow: ${call.title}`)
    if (!proof.ok) return setError(proof.why)
    answer.mutate('allow', { onSuccess: tapDone, onError: (failure) => setError(failure.message) })
  }
  return (
    <Card tone="signal">
      <Head word={word} icon={(color) => <Terminal width={14} height={14} color={color} strokeWidth={2} />} />
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the call, with always and never"
        onPress={() => router.push(`/call/${call.id}`)}
      >
        <View style={{ gap: space.sm }}>
          <Text kind="headline">{call.title}</Text>
          {call.command === null ? null : (
            <Well>
              <Text kind="mono" selectable>
                {call.label ?? call.command}
              </Text>
            </Well>
          )}
          <Text kind="sub" ink="t2">
            {call.reason}
          </Text>
          <Where project={project} task={call.taskTitle} at={call.createdAt} now={now} />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="Deny"
          tone="plain"
          grow
          busy={answer.isPending && answer.variables === 'reject'}
          disabled={answer.isPending || !reachable}
          onPress={() => answer.mutate('reject', { onSuccess: tapDone, onError: (failure) => setError(failure.message) })}
        />
        <Button
          label="Allow once"
          tone="signal"
          grow
          icon={(color) => <Lock width={16} height={16} color={color} strokeWidth={2} />}
          accessibilityHint="Asks for Face ID, then lets the agent run it this once"
          busy={answer.isPending && answer.variables === 'allow'}
          disabled={answer.isPending || !reachable}
          onPress={allow}
        />
      </View>
      {error === null ? null : (
        <Text kind="sub" ink="danger">
          {error}
        </Text>
      )}
    </Card>
  )
}

function QuestionCard({
  call,
  word,
  project,
  now,
}: {
  readonly call: HomeCall
  readonly word: string
  readonly project: ProjectSummary | null
  readonly now: number
}) {
  const theme = useTheme()
  const field = call.question?.fields[0]
  const [picked, setPicked] = useState<string | null>(null)
  const reachable = useConnection().state === 'online'
  const answer = useCommand((client, value: string) =>
    client.answerQuestion({ attentionId: call.id, answers: { [field?.id ?? 'answer']: { values: [value] } } }),
  )
  return (
    <Card tone="signal">
      <Head word={word} icon={(color) => <ChatBubbleQuestion width={14} height={14} color={color} strokeWidth={2} />} />
      <Text kind="headline">{field?.question ?? call.title}</Text>
      {call.question?.why === undefined ? null : (
        <Text kind="sub" ink="t2">
          {whoWorks(call.question.askedBy?.agentId ?? null, call.question.askedBy?.model ?? null)}: “{call.question.why}”
        </Text>
      )}
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {(field?.options ?? []).map((option) => {
          const chosen = picked === option.value
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              onPress={() => {
                tapLight()
                setPicked(option.value)
              }}
              style={({ pressed }) => ({
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: chosen ? theme.signal : theme.line2,
                backgroundColor: chosen ? theme.paper : pressed ? theme.pressed : theme.paper,
                paddingHorizontal: space.md,
                paddingVertical: 10,
                flexDirection: 'row',
                gap: space.md,
                alignItems: 'center',
              })}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: chosen ? 5 : 1.5,
                  borderColor: chosen ? theme.signal : theme.line3,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text kind="bodyMedium">{option.label}</Text>
                {option.note === undefined ? null : (
                  <Text kind="sub" ink="t3">
                    {option.note}
                  </Text>
                )}
              </View>
            </Pressable>
          )
        })}
      </View>
      <Where project={project} task={call.taskTitle} at={call.createdAt} now={now} />
      <Button
        label="Answer"
        tone="signal"
        disabled={picked === null || !reachable}
        busy={answer.isPending}
        onPress={() => (picked === null ? undefined : answer.mutate(picked, { onSuccess: tapDone }))}
      />
    </Card>
  )
}

function StuckCard({
  call,
  word,
  project,
  now,
}: {
  readonly call: HomeCall
  readonly word: string
  readonly project: ProjectSummary | null
  readonly now: number
}) {
  const router = useRouter()
  return (
    <Card tone="signal">
      <Head word={word} icon={(color) => <WarningTriangle width={14} height={14} color={color} strokeWidth={2} />} />
      <Text kind="headline">{call.title}</Text>
      {call.stuck?.detail == null ? null : (
        <Text kind="body" ink="t2">
          {call.stuck.detail}
        </Text>
      )}
      <Where project={project} task={call.taskTitle} at={call.createdAt} now={now} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Open the task" tone="plain" grow onPress={() => router.push(`/task/${call.threadId}`)} />
        <Button label="Decide" tone="signal" grow onPress={() => router.push(`/call/${call.id}`)} />
      </View>
    </Card>
  )
}

function ReadyCard({
  task,
  word,
  project,
  now,
}: {
  readonly task: HomeTask
  readonly word: string
  readonly project: ProjectSummary | null
  readonly now: number
}) {
  const router = useRouter()
  const theme = useTheme()
  const done = useCommand((client, id: string) => client.markTaskDone(id))
  const keep = useCommand((client, id: string) => client.keepTaskForLater(id))
  const change = task.change
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/task/${task.threadId}`)} style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Check width={14} height={14} color={theme.signal} strokeWidth={2.2} />
          <Text kind="label" ink="signal">
            {word}
          </Text>
        </View>
        <Text kind="headline">{task.title}</Text>
        {task.summary === null ? null : (
          <Text kind="sub" ink="t2" lines={3}>
            {task.summary}
          </Text>
        )}
        {change === null ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <GitPullRequest width={15} height={15} color={theme.t2} />
            <Text kind="subMedium" ink="t2">
              {change.short} {change.prefix}
              {change.number}
            </Text>
            {change.checks === null ? null : (
              <Chip
                label={
                  change.checks.outcome === 'passed'
                    ? `Checks ${change.checks.passed}/${change.checks.total}`
                    : `${change.checks.failed} failing`
                }
                tone={change.checks.outcome === 'passed' ? 'ok' : change.checks.outcome === 'failed' ? 'danger' : 'plain'}
              />
            )}
            <Text kind="mono" ink="t3">
              {lines(change.additions, change.deletions)}
            </Text>
          </View>
        )}
        {task.reviewing == null ? null : (
          <Text kind="sub" ink="t2">
            {task.reviewing.findings} findings, {task.reviewing.blocking} blocking · #{task.reviewing.number} by {task.reviewing.author}
          </Text>
        )}
        {task.handed == null || task.handed.files.length === 0 ? null : (
          <Well>
            {task.handed.files.map((one) => (
              <Text key={one.path} kind="mono" ink="t2">
                {one.path}
                {one.add === null ? '' : `  +${one.add}`}
              </Text>
            ))}
          </Well>
        )}
        <Where project={project} at={task.startedAt ?? task.createdAt} now={now} />
      </Pressable>
      {task.kind === 'plain' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Keep for later"
            tone="plain"
            grow
            icon={(color) => <Pin width={16} height={16} color={color} />}
            busy={keep.isPending}
            onPress={() => keep.mutate(task.taskId, { onSuccess: tapDone })}
          />
          <Button label="Done" tone="ink" grow busy={done.isPending} onPress={() => done.mutate(task.taskId, { onSuccess: tapDone })} />
        </View>
      ) : (
        <Button
          label={task.kind === 'review' ? 'Read the draft' : 'Review and merge'}
          tone="ink"
          onPress={() => router.push(`/task/${task.threadId}`)}
        />
      )}
    </Card>
  )
}

export function NeedCard({ need, now }: { readonly need: Need; readonly now: number }) {
  if (need.kind === 'ready') return <ReadyCard task={need.task} word={need.word} project={need.project} now={now} />
  switch (need.call.kind) {
    case 'permission':
      return <PermissionCard call={need.call} word={need.word} project={need.project} now={now} />
    case 'question':
      return <QuestionCard call={need.call} word={need.word} project={need.project} now={now} />
    default:
      return <StuckCard call={need.call} word={need.word} project={need.project} now={now} />
  }
}
