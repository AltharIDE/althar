import { useRouter } from 'expo-router'
import { NavArrowRight } from 'iconoir-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useHome, useNow } from '../../client/react'
import { FindField, FoundList } from '../../components/FindTasks'
import { Card, Divider, LiveDot, ProjectMark, SignalDot, Text } from '../../components/ui'
import { since } from '../../model/words'
import { useTheme } from '../../theme/Theme'
import { space } from '../../theme/tokens'

/*
 * Every project, each in a line: what needs you there (violet), what's at
 * work (cobalt), and when it last had work. A project opens its board.
 */
export default function Projects() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const now = useNow()
  const home = useHome()
  const [find, setFind] = useState('')
  const projects = [...(home.data?.projects ?? [])].sort((a, b) => (b.lastWorkAt ?? '').localeCompare(a.lastWorkAt ?? ''))
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, gap: space.md }}>
      <Text kind="largeTitle" style={{ paddingHorizontal: 4 }}>
        Projects
      </Text>
      <FindField value={find} onChange={setFind} />
      {find.trim() === '' ? null : <FoundList text={find.trim()} projects={projects} />}
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden', display: find.trim() === '' ? 'flex' : 'none' }}>
        {projects.map((project, index) => {
          const needs = project.waiting + project.ready
          return (
            <View key={project.id}>
              {index === 0 ? null : <Divider inset={60} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${project.name}: ${needs} need you, ${project.working} at work`}
                onPress={() => router.push(`/project/${project.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  padding: space.lg,
                  backgroundColor: pressed ? theme.pressed : 'transparent',
                })}
              >
                <ProjectMark name={project.name} ink={project.ink} size={32} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text kind="headline">{project.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                    {needs > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <SignalDot size={7} />
                        <Text kind="sub" ink="signal">
                          {needs} need{needs === 1 ? 's' : ''} you
                        </Text>
                      </View>
                    ) : null}
                    {project.working > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <LiveDot size={5} />
                        <Text kind="sub" ink="live">
                          {project.working} at work
                        </Text>
                      </View>
                    ) : null}
                    {needs === 0 && project.working === 0 ? (
                      <Text kind="sub" ink="t3">
                        {project.lastWorkAt === null ? 'No tasks yet' : `Last work ${since(project.lastWorkAt, now)}`}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <NavArrowRight width={16} height={16} color={theme.t4} />
              </Pressable>
            </View>
          )
        })}
      </Card>
      {find.trim() === '' ? (
        <Text kind="sub" ink="t3" style={{ paddingHorizontal: 4 }}>
          A new project starts on your Mac, where its folders are.
        </Text>
      ) : null}
    </ScrollView>
  )
}
