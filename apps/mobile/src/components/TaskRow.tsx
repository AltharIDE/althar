import type { HomeTask, ProjectSummary } from '@althar/contracts'
import { useRouter } from 'expo-router'
import { NavArrowRight, Pause, Timer } from 'iconoir-react-native'
import { Pressable, View } from 'react-native'

import { useStreaming } from '../client/react'
import { stepWords, workerOf } from '../model/home'
import { duration } from '../model/words'
import { useTheme } from '../theme/Theme'
import { space } from '../theme/tokens'
import { LiveDot, ProjectMark, Text } from './ui'

/*
 * A task at work, in a row: cobalt while an agent is on it, what step and
 * who, for how long, and what its lead says as it says it.
 */
export function TaskRow({ task, project, now }: { readonly task: HomeTask; readonly project: ProjectSummary | null; readonly now: number }) {
  const router = useRouter()
  const theme = useTheme()
  const streamed = useStreaming(task.threadId)
  const running = task.phase === 'running'
  const said = streamed?.text ?? task.summary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${stepWords(task, now)}`}
      onPress={() => router.push(`/task/${task.threadId}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? theme.pressed : 'transparent',
        alignItems: 'flex-start',
      })}
    >
      <View style={{ width: 20, alignItems: 'center', paddingTop: 1 }}>
        {running ? (
          <LiveDot />
        ) : task.phase === 'planned' ? (
          <Timer width={16} height={16} color={theme.t3} />
        ) : (
          <Pause width={16} height={16} color={theme.warm} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text kind="bodyMedium" lines={2}>
          {task.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {project === null ? null : <ProjectMark name={project.name} ink={project.ink} size={14} />}
          <Text kind="sub" ink={running ? 'live' : 't3'}>
            {stepWords(task, now)}
          </Text>
          {task.phase === 'planned' ? null : (
            <Text kind="sub" ink="t3">
              · {workerOf(task)}
              {task.startedAt === null ? '' : ` · ${duration(now - Date.parse(task.startedAt))}`}
            </Text>
          )}
        </View>
        {said === null ? null : (
          <Text kind="sub" ink="t2" lines={2}>
            {said}
          </Text>
        )}
      </View>
      <NavArrowRight width={16} height={16} color={theme.t4} style={{ marginTop: 2 }} />
    </Pressable>
  )
}
