import type { ProjectInk } from '@althar/contracts'
import { useEffect, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text as NativeText,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'

import { useTheme } from '../theme/Theme'
import { fonts, radius, space, type, type Palette } from '../theme/tokens'

/*
 * The phone's primitives, drawn from the kit's: ink on paper, a faint line
 * where one must be, cobalt for what runs, violet for what needs you.
 */

type Ink = 't1' | 't2' | 't3' | 't4' | 'signal' | 'live' | 'danger' | 'ok' | 'warm' | 'onSignal' | 'onInk'

export function Text({
  kind = 'body',
  ink = 't1',
  style,
  children,
  lines,
  selectable,
}: {
  readonly kind?: keyof typeof type
  readonly ink?: Ink
  readonly style?: StyleProp<TextStyle>
  readonly children: ReactNode
  readonly lines?: number
  readonly selectable?: boolean
}) {
  const theme = useTheme()
  return (
    <NativeText numberOfLines={lines} selectable={selectable} style={[type[kind], { color: theme[ink] }, style]}>
      {children}
    </NativeText>
  )
}

export function Card({
  children,
  style,
  tone = 'plain',
}: {
  readonly children: ReactNode
  readonly style?: StyleProp<ViewStyle>
  readonly tone?: 'plain' | 'signal'
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: tone === 'signal' ? theme.signalPaper : theme.raised,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: tone === 'signal' ? theme.signalLine : theme.line2,
          padding: space.lg,
          gap: space.md,
          boxShadow: `0 1px 2px ${theme.shadow}`,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

type ButtonTone = 'signal' | 'ink' | 'plain' | 'quiet' | 'danger'

const buttonColors = (theme: Palette, tone: ButtonTone, pressed: boolean) => {
  switch (tone) {
    case 'signal':
      return { bg: pressed ? theme.signal : theme.signalFill, fg: theme.onSignal, border: 'transparent' }
    case 'ink':
      return { bg: theme.inkFill, fg: theme.onInk, border: 'transparent' }
    case 'danger':
      return { bg: pressed ? theme.dangerDim : 'transparent', fg: theme.danger, border: theme.line3 }
    case 'quiet':
      return { bg: pressed ? theme.pressed : 'transparent', fg: theme.t2, border: 'transparent' }
    case 'plain':
      return { bg: pressed ? theme.pressed : theme.paper, fg: theme.t1, border: theme.line3 }
  }
}

export function Button({
  label,
  onPress,
  tone = 'plain',
  icon,
  busy = false,
  disabled = false,
  grow = false,
  small = false,
  accessibilityHint,
}: {
  readonly label: string
  readonly onPress: PressableProps['onPress']
  readonly tone?: ButtonTone
  readonly icon?: (color: string) => ReactNode
  readonly busy?: boolean
  readonly disabled?: boolean
  readonly grow?: boolean
  readonly small?: boolean
  readonly accessibilityHint?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => {
        const colors = buttonColors(theme, tone, pressed)
        return {
          flexGrow: grow ? 1 : 0,
          flexBasis: grow ? 0 : 'auto',
          minHeight: small ? 36 : 44,
          paddingHorizontal: small ? space.md : space.lg,
          borderRadius: radius.md,
          backgroundColor: colors.bg,
          borderWidth: colors.border === 'transparent' ? 0 : 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          opacity: disabled ? 0.45 : 1,
        }
      }}
    >
      {({ pressed }) => {
        const colors = buttonColors(theme, tone, pressed)
        return busy ? (
          <ActivityIndicator color={colors.fg} />
        ) : (
          <>
            {icon?.(colors.fg)}
            <NativeText style={[small ? type.subMedium : type.bodyMedium, { color: colors.fg, fontFamily: fonts.semibold }]}>{label}</NativeText>
          </>
        )
      }}
    </Pressable>
  )
}

/** A small word on a fill: what kind of call, where a task stands. */
export function Chip({ label, tone = 'plain' }: { readonly label: string; readonly tone?: 'signal' | 'live' | 'ok' | 'plain' | 'danger' | 'warm' }) {
  const theme = useTheme()
  const colors = {
    signal: { bg: theme.signalDim, fg: theme.signal },
    live: { bg: theme.liveDim, fg: theme.live },
    ok: { bg: theme.okDim, fg: theme.ok },
    danger: { bg: theme.dangerDim, fg: theme.danger },
    warm: { bg: theme.dangerDim, fg: theme.warm },
    plain: { bg: theme.pressed, fg: theme.t2 },
  }[tone]
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <NativeText style={[type.caption, { color: colors.fg, fontFamily: fonts.semibold }]}>{label}</NativeText>
    </View>
  )
}

/** A project's mark: its first letter on its own ink. */
export function ProjectMark({ name, ink, size = 20 }: { readonly name: string; readonly ink: ProjectInk; readonly size?: number }) {
  const theme = useTheme()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: theme.projects[ink],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <NativeText style={{ color: '#fff', fontFamily: fonts.bold, fontSize: size * 0.55, lineHeight: size * 0.7 }}>
        {name.slice(0, 1).toUpperCase()}
      </NativeText>
    </View>
  )
}

/** Cobalt, breathing: an agent at work now. */
export function LiveDot({ size = 8 }: { readonly size?: number }) {
  const theme = useTheme()
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 2,
          height: size * 2,
          borderRadius: size,
          backgroundColor: theme.liveDim,
          opacity: pulse,
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.live }} />
    </View>
  )
}

/** A dot for something that waits on the person. */
export function SignalDot({ size = 8 }: { readonly size?: number }) {
  const theme = useTheme()
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.signal }} />
}

export function SectionHead({ title, count, action }: { readonly title: string; readonly count?: number; readonly action?: ReactNode }) {
  return (
    <View
      accessibilityRole="header"
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: space.lg }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <Text kind="headline">{title}</Text>
        {count === undefined ? null : (
          <Text kind="subMedium" ink="t3">
            {count}
          </Text>
        )}
      </View>
      {action}
    </View>
  )
}

/** A recess holding a command or a path, in mono. */
export function Well({ children, style }: { readonly children: ReactNode; readonly style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return (
    <View style={[{ backgroundColor: theme.well, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 10, borderWidth: 1, borderColor: theme.line }, style]}>
      {children}
    </View>
  )
}

export function Divider({ inset = 0 }: { readonly inset?: number }) {
  const theme = useTheme()
  return <View style={{ height: 1, backgroundColor: theme.line, marginLeft: inset }} />
}

/** A plan's steps as a track: done, now, to come. */
export function StepTrack({
  steps,
}: {
  readonly steps: ReadonlyArray<{ readonly key: string; readonly label: string; readonly state: 'done' | 'now' | 'next' }>
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={steps.map((step) => `${step.label}: ${step.state === 'done' ? 'done' : step.state === 'now' ? 'now' : 'to come'}`).join(', ')}>
      {steps.map((step) => (
        <View key={step.key} style={{ flex: 1, gap: 6 }}>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: step.state === 'done' ? theme.t3 : step.state === 'now' ? theme.live : theme.line2,
            }}
          />
          <Text kind="caption" ink={step.state === 'now' ? 'live' : step.state === 'done' ? 't2' : 't4'}>
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  )
}
