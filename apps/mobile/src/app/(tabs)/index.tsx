import type { HomeEvent, ProjectSummary } from '@althar/contracts'
import { useRouter } from 'expo-router'
import { CheckCircle, DoubleCheck, Flash, Microphone, Plus } from 'iconoir-react-native'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useConnection, useHome, useNow } from '../../client/react'
import { ConnectionBanner } from '../../components/ConnectionBanner'
import { NeedCard } from '../../components/NeedCard'
import { TaskRow } from '../../components/TaskRow'
import { Card, Divider, LiveDot, SectionHead, Text } from '../../components/ui'
import { atWorkOf, needsOf, upNextOf } from '../../model/home'
import { plural, since } from '../../model/words'
import { useTheme } from '../../theme/Theme'
import { radius, space } from '../../theme/tokens'

/*
 * The home: what needs you, first and answered in place; then what's at
 * work, what's next, and what the loop did while you were away. One column,
 * newest at the top of each, as the desktop's home reads.
 */

function EventRow({ event, projects, now }: { readonly event: HomeEvent; readonly projects: ReadonlyArray<ProjectSummary>; readonly now: number }) {
  const theme = useTheme()
  const router = useRouter()
  const project = event.kind === 'answered' ? null : projects.find((one) => one.id === event.projectId)
  const [title, detail] =
    event.kind === 'step'
      ? [
          `${event.result.step === 'review' ? 'Review' : 'Implement'} ${event.result.verdict === 'pass' ? 'passed' : 'finished'}: ${event.task.title}`,
          event.result.summary,
        ]
      : event.kind === 'dealt'
        ? [event.title, event.description]
        : [`${plural(event.count, 'permission')} answered by ${event.by === 'coordinator' ? 'the coordinator' : 'your rules'}`, null]
  const icon =
    event.kind === 'step' ? (
      <CheckCircle width={16} height={16} color={theme.ok} />
    ) : event.kind === 'dealt' ? (
      <Flash width={16} height={16} color={theme.warm} />
    ) : (
      <DoubleCheck width={16} height={16} color={theme.t3} />
    )
  return (
    <Pressable
      disabled={event.kind === 'answered'}
      onPress={() => (event.kind === 'answered' ? undefined : router.push(`/task/${event.task.threadId}`))}
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, padding: space.lg, backgroundColor: pressed ? theme.pressed : 'transparent' })}
    >
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text kind="subMedium">{title}</Text>
        {detail == null ? null : (
          <Text kind="sub" ink="t2" lines={2}>
            {detail}
          </Text>
        )}
        <Text kind="caption" ink="t4">
          {[project?.name, since(event.at, now)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  )
}

export default function HomeScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const now = useNow()
  const home = useHome()
  const connection = useConnection()
  const data = home.data
  const needs = data === undefined ? [] : needsOf(data)
  const atWork = data === undefined ? [] : atWorkOf(data)
  const upNext = data === undefined ? [] : upNextOf(data)
  const projectOf = (id: string) => data?.projects.find((one) => one.id === id) ?? null

  return (
    <View style={{ flex: 1, backgroundColor: theme.page }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md }}
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} />}
      >
        <View style={{ gap: 4, paddingHorizontal: 4 }}>
          <Text kind="largeTitle" style={{ fontSize: 30 }}>
            {needs.length > 0 ? `${needs.length} need${needs.length === 1 ? 's' : ''} you` : 'All clear'}
          </Text>
          {connection.state === 'online' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {atWork.length > 0 ? <LiveDot size={6} /> : null}
              <Text kind="sub" ink="t3">
                {atWork.length > 0 ? `${atWork.length} at work on ${connection.mac.name}` : `Nothing at work on ${connection.mac.name}`}
              </Text>
            </View>
          ) : null}
        </View>

        <ConnectionBanner now={now} waiting={needs.filter((one) => one.kind === 'call').length} />

        {data === undefined ? (
          <Text kind="sub" ink="t3">
            {home.isError ? home.error.message : 'Reading your Mac…'}
          </Text>
        ) : (
          <>
            {needs.length === 0 ? (
              <Card>
                <Text kind="bodyMedium">Nothing needs you.</Text>
                <Text kind="sub" ink="t2">
                  Althar taps you when an agent asks, or work is ready.
                </Text>
              </Card>
            ) : (
              needs.map((need) => <NeedCard key={need.id} need={need} now={now} />)
            )}

            {atWork.length === 0 ? null : (
              <>
                <SectionHead title="At work" count={atWork.length} />
                <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
                  {atWork.map((task, index) => (
                    <View key={task.taskId}>
                      {index === 0 ? null : <Divider inset={52} />}
                      <TaskRow task={task} project={projectOf(task.projectId)} now={now} />
                    </View>
                  ))}
                </Card>
              </>
            )}

            {upNext.length === 0 ? null : (
              <>
                <SectionHead title="Up next" count={upNext.length} />
                <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
                  {upNext.map((task, index) => (
                    <View key={task.taskId}>
                      {index === 0 ? null : <Divider inset={52} />}
                      <TaskRow task={task} project={projectOf(task.projectId)} now={now} />
                    </View>
                  ))}
                </Card>
              </>
            )}

            {data.events.length === 0 ? null : (
              <>
                <SectionHead title="Since you looked" />
                <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
                  {data.events.map((event, index) => (
                    <View key={event.id}>
                      {index === 0 ? null : <Divider inset={44} />}
                      <EventRow event={event} projects={data.projects} now={now} />
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New task"
        accessibilityHint="Says what you want done, by voice or typing"
        onPress={() => router.push('/new')}
        style={({ pressed }) => ({
          position: 'absolute',
          right: space.lg,
          bottom: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: 18,
          height: 52,
          borderRadius: radius.pill,
          backgroundColor: pressed ? theme.t2 : theme.inkFill,
          boxShadow: `0 6px 18px ${theme.shadow}`,
        })}
      >
        <Plus width={18} height={18} color={theme.onInk} strokeWidth={2.2} />
        <Text kind="bodyMedium" ink="onInk">
          New task
        </Text>
        <View style={{ width: 1, height: 18, backgroundColor: theme.onInk, opacity: 0.25 }} />
        <Microphone width={18} height={18} color={theme.onInk} />
      </Pressable>
    </View>
  )
}
