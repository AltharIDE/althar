import type { ChangeSummary, HomeCall, ThreadSnapshot } from '@althar/contracts'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { GitMerge, GitPullRequest, Lock, NavArrowRight, Page, Pin } from 'iconoir-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native'

import { useCommand, useConnection, useHome, useNow, useStreaming, useThread } from '../../../client/react'
import { Composer } from '../../../components/Composer'
import { NeedCard } from '../../../components/NeedCard'
import { Thread } from '../../../components/Thread'
import { Button, Card, Chip, LiveDot, ProjectMark, StepTrack, Text } from '../../../components/ui'
import { confirmIsYou, tapDone } from '../../../lib/device'
import { callKindOf, isSettleable, readyKindOf, takesDone } from '../../../model/calls'
import { stepWords, trackOf, workerOf } from '../../../model/home'
import { duration, lines, plural } from '../../../model/words'
import { useTheme } from '../../../theme/Theme'
import { radius, space } from '../../../theme/tokens'

/*
 * A task: where it stands, what waits on you in it, its pull request and
 * what it changed, what its lead reported, and its thread, with the
 * composer under it. Merging asks for Face ID, at the head you saw.
 */

function PullRequest({
  change,
  taskId,
  files,
  threadId,
}: {
  readonly change: ChangeSummary
  readonly taskId: string
  readonly files: number
  readonly threadId: string
}) {
  const theme = useTheme()
  const router = useRouter()
  const reachable = useConnection().state === 'online'
  const [error, setError] = useState<string | null>(null)
  const merge = useCommand((client, head: string) => client.merge({ taskId, head }))
  const checks = change.checks
  const onMerge = async () => {
    if (change.head === null) return
    setError(null)
    const proof = await confirmIsYou(`Merge ${change.short} ${change.prefix}${change.number}`)
    if (!proof.ok) return setError(proof.why)
    merge.mutate(change.head, { onSuccess: tapDone, onError: (failure) => setError(failure.message) })
  }
  return (
    <Card>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(change.url)} style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {change.state === 'merged' ? (
            <GitMerge width={18} height={18} color={theme.signal} />
          ) : (
            <GitPullRequest width={18} height={18} color={theme.ok} />
          )}
          <Text kind="headline" style={{ flex: 1 }} lines={1}>
            {change.short} {change.prefix}
            {change.number}
          </Text>
          <Chip
            label={change.state === 'merged' ? 'Merged' : change.draft ? 'Draft' : 'Open'}
            tone={change.state === 'merged' ? 'signal' : 'plain'}
          />
        </View>
        <Text kind="sub" ink="t2" lines={2}>
          {change.title}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text kind="mono" ink="t2">
            {lines(change.additions, change.deletions)}
          </Text>
          <Text kind="sub" ink="t3">
            {change.repository} · into {change.target ?? 'main'}
          </Text>
        </View>
      </Pressable>
      {checks === null ? null : (
        <View style={{ gap: 4, padding: space.md, borderRadius: radius.sm, backgroundColor: theme.well }}>
          <Text kind="subMedium" ink={checks.outcome === 'failed' ? 'danger' : checks.outcome === 'passed' ? 'ok' : 't2'}>
            {checks.outcome === 'passed'
              ? `All ${checks.total} checks passed`
              : checks.outcome === 'failed'
                ? `${checks.failed} of ${checks.total} checks failed`
                : `${checks.running} checks running`}
          </Text>
          {checks.list.slice(0, 4).map((check) => (
            <Text key={check.name} kind="sub" ink="t3">
              {check.state === 'passed' ? '✓' : check.state === 'failed' ? '✕' : '•'} {check.name}
            </Text>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/task/[threadId]/changes', params: { threadId, taskId } })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingVertical: 6,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Page width={18} height={18} color={theme.t2} />
        <Text kind="bodyMedium" style={{ flex: 1 }}>
          {plural(files, 'file')} changed
        </Text>
        <NavArrowRight width={16} height={16} color={theme.t4} />
      </Pressable>
      {change.state === 'open' ? (
        <Button
          label="Merge"
          tone="ink"
          icon={(color) => <Lock width={16} height={16} color={color} strokeWidth={2} />}
          accessibilityHint="Asks for Face ID, then merges what you see here, and nothing newer"
          disabled={!reachable || checks?.outcome === 'failed'}
          busy={merge.isPending}
          onPress={onMerge}
        />
      ) : null}
      {error === null ? null : (
        <Text kind="sub" ink="danger">
          {error}
        </Text>
      )}
    </Card>
  )
}

function Head({ thread, now }: { readonly thread: ThreadSnapshot; readonly now: number }) {
  const home = useHome()
  const card = home.data?.tasks.find((one) => one.threadId === thread.threadId)
  const project = home.data?.projects.find((one) => one.id === thread.project.id)
  const running = thread.task.phase === 'running'
  const status =
    card === undefined
      ? (thread.task.phase ?? '')
      : card.phase === 'ready'
        ? readyKindOf(card)
        : card.phase === 'waiting'
          ? 'Waiting on you'
          : `${stepWords(card, now)} · ${workerOf(card)}${card.startedAt === null ? '' : ` · ${duration(now - Date.parse(card.startedAt))}`}`
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {project === undefined ? null : <ProjectMark name={project.name} ink={project.ink} size={16} />}
        <Text kind="sub" ink="t3">
          {thread.project.name}
          {thread.task.branch === null ? '' : ` · ${thread.task.branch}`}
        </Text>
      </View>
      <Text kind="title">{thread.task.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {running ? <LiveDot size={6} /> : null}
        <Text kind="subMedium" ink={running ? 'live' : card?.phase === 'ready' || card?.phase === 'waiting' ? 'signal' : 't2'}>
          {status}
        </Text>
      </View>
      {card?.plan == null ? null : <StepTrack steps={trackOf(card)} />}
      {card !== undefined && isSettleable(card) && takesDone(card) ? <Settle taskId={card.taskId} kept={card.phase === 'kept'} /> : null}
    </View>
  )
}

/** A finished task that isn't a change: the person's to settle, here as in its card (ADR-051). */
function Settle({ taskId, kept }: { readonly taskId: string; readonly kept: boolean }) {
  const reachable = useConnection().state === 'online'
  const done = useCommand((client, id: string) => client.markTaskDone(id))
  const keep = useCommand((client, id: string) => client.keepTaskForLater(id))
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {kept ? null : (
        <Button
          label="Keep for later"
          tone="plain"
          grow
          icon={(color) => <Pin width={16} height={16} color={color} />}
          disabled={!reachable}
          busy={keep.isPending}
          onPress={() => keep.mutate(taskId, { onSuccess: tapDone })}
        />
      )}
      <Button
        label="Done"
        tone="ink"
        grow
        disabled={!reachable}
        busy={done.isPending}
        onPress={() => done.mutate(taskId, { onSuccess: tapDone })}
      />
    </View>
  )
}

export default function TaskScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const now = useNow()
  const thread = useThread(threadId)
  const home = useHome()
  const streamed = useStreaming(threadId)
  const stop = useCommand((client, taskId: string) => client.stopTask(taskId))
  const data = thread.data
  const project = home.data?.projects.find((one) => one.id === data?.project.id) ?? null
  const calls: ReadonlyArray<HomeCall> =
    data === undefined
      ? []
      : data.attention.map((attention) => ({
          ...attention,
          taskId: data.task.id,
          threadId: data.threadId,
          taskTitle: data.task.title,
          taskSlug: data.task.slug,
          projectId: data.project.id,
        }))
  const change = data?.task.changes.at(-1) ?? null
  const working = data?.session?.turnRunning === true || data?.task.phase === 'running'
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.page }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: '',
          headerRight: () =>
            data !== undefined && data.task.actions.includes('stop') ? (
              <Button label="Stop" tone="quiet" small busy={stop.isPending} onPress={() => stop.mutate(data.task.id)} />
            ) : null,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        {data === undefined ? (
          <Text kind="sub" ink="t3">
            {thread.isError ? thread.error.message : 'Reading the task…'}
          </Text>
        ) : (
          <>
            <Head thread={data} now={now} />
            {calls.map((call) => (
              <NeedCard key={call.id} need={{ kind: 'call', id: call.id, call, word: callKindOf(call), project }} now={now} />
            ))}
            {change === null ? null : (
              <PullRequest change={change} taskId={data.task.id} files={data.task.files.length} threadId={data.threadId} />
            )}
            {change === null && data.task.files.length > 0 ? (
              <Button
                label={`${plural(data.task.files.length, 'file')} changed so far`}
                tone="plain"
                onPress={() =>
                  router.push({ pathname: '/task/[threadId]/changes', params: { threadId: data.threadId, taskId: data.task.id } })
                }
              />
            ) : null}
            <Thread threadId={data.threadId} items={data.items} now={now} streamed={streamed} />
          </>
        )}
      </ScrollView>
      {data === undefined ? null : <Composer threadId={data.threadId} leadWorking={working} />}
    </KeyboardAvoidingView>
  )
}
