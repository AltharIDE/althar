import { useRouter } from 'expo-router'
import { Microphone } from 'iconoir-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'

import { useCommand, useConnection, useHome } from '../client/react'
import { Button, ProjectMark, Text } from '../components/ui'
import { tapDone } from '../lib/device'
import { useTheme } from '../theme/Theme'
import { fonts, radius, space } from '../theme/tokens'

/*
 * A new task, from the phone: which project, and what should be done, said
 * or typed. The coordinator on the Mac plans it, as for any task: who
 * leads, who reviews, when it starts. Starting local work from a phone is
 * what people ask of every tool like this first.
 */
export default function NewTask() {
  const theme = useTheme()
  const router = useRouter()
  const home = useHome()
  const reachable = useConnection().state === 'online'
  const projects = home.data?.projects ?? []
  const [projectId, setProjectId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chosen = projectId ?? projects[0]?.id ?? null
  const create = useCommand((client, input: { readonly projectId: string; readonly body: string }) => {
    const [first = input.body] = input.body.split('\n')
    return client.createTask({ projectId: input.projectId, title: first.slice(0, 80), description: input.body })
  })
  const go = () => {
    if (chosen === null || body.trim() === '') return
    setError(null)
    create.mutate(
      { projectId: chosen, body: body.trim() },
      {
        onSuccess: (made) => {
          tapDone()
          router.replace(`/task/${(made as { threadId: string }).threadId}`)
        },
        onError: (failure) => setError(`Not sent: ${failure.message}. What you wrote is still here.`),
      },
    )
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.page }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <Text kind="label" ink="t3">
            Project
          </Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {projects.map((project) => {
              const on = chosen === project.id
              return (
                <Pressable
                  key={project.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setProjectId(project.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: space.md,
                    paddingVertical: 8,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: on ? theme.t1 : theme.line3,
                    backgroundColor: on ? theme.paper : 'transparent',
                  }}
                >
                  <ProjectMark name={project.name} ink={project.ink} size={16} />
                  <Text kind="subMedium" ink={on ? 't1' : 't2'}>
                    {project.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <Text kind="label" ink="t3">
            What should be done?
          </Text>
          <TextInput
            accessibilityLabel="What should be done"
            value={body}
            onChangeText={setBody}
            autoFocus
            multiline
            placeholder="Add per-customer rate limits to /charges, with a 429 that says when to retry."
            placeholderTextColor={theme.t4}
            style={{
              minHeight: 160,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: theme.line3,
              backgroundColor: theme.paper,
              color: theme.t1,
              padding: space.lg,
              fontFamily: fonts.regular,
              fontSize: 17,
              lineHeight: 24,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Microphone width={14} height={14} color={theme.t3} />
            <Text kind="caption" ink="t3">
              Say it with the keyboard’s microphone; the lead is told it was dictated.
            </Text>
          </View>
        </View>
        <Text kind="sub" ink="t2">
          The coordinator on your Mac plans it: who leads, who reviews. It starts on its own unless you hold it.
        </Text>
        <Button label="Plan it" tone="ink" disabled={!reachable || chosen === null || body.trim() === ''} busy={create.isPending} onPress={go} />
        {error === null ? null : (
          <Text kind="sub" ink="danger">
            {error}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
