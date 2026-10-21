import { ArrowUp, Microphone } from 'iconoir-react-native'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { useCommand, useConnection } from '../client/react'
import { tapDone } from '../lib/device'
import { useTheme } from '../theme/Theme'
import { fonts, radius, space } from '../theme/tokens'
import { Text } from './ui'

/*
 * Writing to a task's lead. While it works, what you write waits for its
 * turn to end (Queue); Send now stops the turn to read it. What you wrote
 * clears only once the Mac has it, so nothing is lost to a dropped
 * connection. The microphone is the keyboard's dictation for now: a
 * transcript on the phone is a later step.
 */
export function Composer({
  threadId,
  leadWorking,
  placeholder = 'Tell the lead…',
  onSent,
}: {
  readonly threadId: string
  readonly leadWorking: boolean
  readonly placeholder?: string
  /** Once the Mac has it: the screen follows it to the thread's end. */
  readonly onSent?: () => void
}) {
  const theme = useTheme()
  const reachable = useConnection().state === 'online'
  const [body, setBody] = useState('')
  const [now, setNow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = useCommand((client, input: { readonly body: string; readonly interrupt: boolean }) =>
    client.send({ threadId, body: input.body, disposition: input.interrupt ? 'interrupt_and_continue' : 'after_current' }),
  )
  const go = () => {
    const text = body.trim()
    if (text === '') return
    setError(null)
    send.mutate(
      { body: text, interrupt: now },
      {
        onSuccess: () => {
          setBody('')
          setNow(false)
          tapDone()
          onSent?.()
        },
        onError: (failure) => setError(`Not sent: ${failure.message}. It’s still here to send again.`),
      },
    )
  }
  return (
    <View style={{ gap: 6, padding: space.md, borderTopWidth: 1, borderTopColor: theme.line2, backgroundColor: theme.raised }}>
      {leadWorking ? (
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
          {(
            [
              [false, 'Queue', 'The lead reads it next'],
              [true, 'Send now', 'Stops its turn to read it'],
            ] as const
          ).map(([value, label, hint]) => (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityState={{ checked: now === value }}
              accessibilityHint={hint}
              onPress={() => setNow(value)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: radius.pill,
                backgroundColor: now === value ? theme.inkFill : theme.pressed,
              }}
            >
              <Text kind="caption" ink={now === value ? 'onInk' : 't2'}>
                {label}
              </Text>
            </Pressable>
          ))}
          <Text kind="caption" ink="t3" style={{ alignSelf: 'center', marginLeft: 4 }}>
            {now ? 'Stops its turn to read it' : 'The lead reads it next'}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <TextInput
          accessibilityLabel={placeholder === 'Tell the lead…' ? 'Message to the lead' : placeholder.replace('…', '')}
          value={body}
          onChangeText={setBody}
          placeholder={reachable ? placeholder : 'Your Mac is away'}
          placeholderTextColor={theme.t4}
          editable={reachable}
          multiline
          style={{
            flex: 1,
            minHeight: 42,
            maxHeight: 120,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.line3,
            backgroundColor: theme.paper,
            color: theme.t1,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 10,
            fontFamily: fonts.regular,
            fontSize: 15,
          }}
        />
        {body.trim() === '' ? (
          <View
            accessibilityLabel="Dictate"
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.pressed,
            }}
          >
            <Microphone width={20} height={20} color={theme.t2} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={now ? 'Send now' : 'Queue'}
            disabled={send.isPending || !reachable}
            onPress={go}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.inkFill,
            }}
          >
            <ArrowUp width={20} height={20} color={theme.onInk} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
      {error === null ? null : (
        <Text kind="sub" ink="danger">
          {error}
        </Text>
      )}
    </View>
  )
}
