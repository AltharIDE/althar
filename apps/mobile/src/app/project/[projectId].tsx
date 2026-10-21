import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { useBoard, useHome, useNow } from '../../client/react'
import { NeedCard } from '../../components/NeedCard'
import { TaskRow } from '../../components/TaskRow'
import { Card, Divider, ProjectMark, Text } from '../../components/ui'
import { callKindOf, readyKindOf, standingCalls } from '../../model/calls'
import { lanesOf } from '../../model/home'
import { useTheme } from '../../theme/Theme'
import { radius, space } from '../../theme/tokens'

/*
 * A project's board, as a phone holds it: the desktop's lanes as one
 * segmented list, Needs you first, since a phone shows one lane at a time.
 */

const LANES = [
  ['needsYou', 'Needs you'],
  ['running', 'Running'],
  ['upNext', 'Up next'],
  ['settled', 'Settled'],
] as const

type Lane = (typeof LANES)[number][0]

export default function Board() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const theme = useTheme()
  const now = useNow()
  const home = useHome()
  const board = useBoard(projectId)
  const [lane, setLane] = useState<Lane>('needsYou')
  const project = home.data?.projects.find((one) => one.id === projectId) ?? null
  const lanes = board.data === undefined ? null : lanesOf(board.data)
  const calls = board.data === undefined ? [] : standingCalls(board.data.tasks, board.data.calls)
  const shown = lanes?.[lane] ?? []
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: '' }} />
      {project === null ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <ProjectMark name={project.name} ink={project.ink} size={36} />
          <View>
            <Text kind="title">{project.name}</Text>
            <Text kind="sub" ink="t3">
              {project.repositories.join(', ')} · {board.data?.settledTotal ?? 0} settled
            </Text>
          </View>
        </View>
      )}
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', backgroundColor: theme.pressed, borderRadius: radius.md, padding: 3, gap: 2 }}
      >
        {LANES.map(([key, label]) => {
          const count = key === 'needsYou' ? calls.length + (lanes?.needsYou.filter((task) => task.phase === 'ready').length ?? 0) : (lanes?.[key].length ?? 0)
          const chosen = lane === key
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: chosen }}
              onPress={() => setLane(key)}
              style={{ flex: 1, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: chosen ? theme.paper : 'transparent', alignItems: 'center' }}
            >
              <Text kind="caption" ink={chosen ? 't1' : 't2'} lines={1}>
                {label}
                {count > 0 ? ` ${count}` : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {lane === 'needsYou' ? (
        <>
          {calls.map((call) => (
            <NeedCard key={call.id} need={{ kind: 'call', id: call.id, call: { ...call, projectId }, word: callKindOf(call), project }} now={now} />
          ))}
          {(lanes?.needsYou ?? [])
            .filter((task) => task.phase === 'ready')
            .map((task) => (
              <NeedCard key={task.taskId} need={{ kind: 'ready', id: task.taskId, task: { ...task, projectId }, word: readyKindOf(task), project }} now={now} />
            ))}
        </>
      ) : shown.length === 0 ? (
        <Text kind="sub" ink="t3" style={{ padding: space.lg, textAlign: 'center' }}>
          {lane === 'settled' ? 'Settled tasks are on your Mac.' : 'Nothing here.'}
        </Text>
      ) : (
        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          {shown.map((task, index) => (
            <View key={task.taskId}>
              {index === 0 ? null : <Divider inset={52} />}
              <TaskRow task={{ ...task, projectId }} project={project} now={now} />
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  )
}
