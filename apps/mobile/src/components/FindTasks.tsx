import type { FoundTask, ProjectSummary } from '@althar/contracts'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Search } from 'iconoir-react-native'
import { Pressable, Text as NativeText, TextInput, View } from 'react-native'

import { useClient } from '../client/react'
import { useTheme } from '../theme/Theme'
import { fonts, radius, space, type } from '../theme/tokens'
import { Card, Divider, ProjectMark, Text } from './ui'

/*
 * Finding a task by what it was about (the desktop's ⌘K): its title, what
 * its lead said, its pull request. What matched besides the title shows
 * under it, the words found marked.
 */

const phaseWords: Readonly<Record<FoundTask['phase'], string>> = {
  planned: 'Up next',
  held: 'Paused',
  running: 'At work',
  waiting: 'Needs you',
  ready: 'Needs you',
  kept: 'Kept for later',
  stopped: 'Stopped',
  settled: 'Settled',
}

export function FindField({ value, onChange }: { readonly value: string; readonly onChange: (text: string) => void }) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
        height: 42,
        borderRadius: radius.md,
        backgroundColor: theme.pressed,
      }}
    >
      <Search width={18} height={18} color={theme.t3} />
      <TextInput
        accessibilityLabel="Find a task"
        accessibilityRole="search"
        value={value}
        onChangeText={onChange}
        placeholder="Find a task"
        placeholderTextColor={theme.t3}
        returnKeyType="search"
        autoCorrect={false}
        style={{ flex: 1, color: theme.t1, fontFamily: fonts.regular, fontSize: 16, outlineWidth: 0 }}
      />
    </View>
  )
}

export function FoundList({ text, projects }: { readonly text: string; readonly projects: ReadonlyArray<ProjectSummary> }) {
  const client = useClient()
  const router = useRouter()
  const theme = useTheme()
  const found = useQuery({ queryKey: ['search', text], queryFn: () => client.searchTasks({ text }) })
  const tasks = found.data?.tasks ?? []
  if (found.data !== undefined && tasks.length === 0) {
    return (
      <Text kind="sub" ink="t3" style={{ padding: space.lg, textAlign: 'center' }}>
        No task about “{text}”.
      </Text>
    )
  }
  return (
    <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
      {tasks.map((task, index) => {
        const project = projects.find((one) => one.id === task.projectId)
        return (
          <View key={task.taskId}>
            {index === 0 ? null : <Divider inset={44} />}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/task/${task.threadId}`)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: space.md,
                padding: space.lg,
                backgroundColor: pressed ? theme.pressed : 'transparent',
              })}
            >
              <View style={{ paddingTop: 2 }}>
                {project === undefined ? null : <ProjectMark name={project.name} ink={project.ink} size={16} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text kind="bodyMedium">{task.title}</Text>
                {task.matched === null ? null : (
                  <NativeText style={[type.sub, { color: theme.t2 }]} numberOfLines={2}>
                    {task.matched.map((part, at) => (
                      <NativeText key={at} style={part.hit ? { fontFamily: fonts.semibold, color: theme.t1 } : undefined}>
                        {part.text}
                      </NativeText>
                    ))}
                  </NativeText>
                )}
                <Text
                  kind="caption"
                  ink={task.phase === 'waiting' || task.phase === 'ready' ? 'signal' : task.phase === 'running' ? 'live' : 't3'}
                >
                  {[phaseWords[task.phase], project?.name, task.pullRequest].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          </View>
        )
      })}
    </Card>
  )
}
