import { Lock } from 'iconoir-react-native'
import { useState, type ReactNode } from 'react'
import { ScrollView, Switch, View } from 'react-native'

import { Card, Divider, LiveDot, SignalDot, Text } from '../components/ui'
import { useTheme } from '../theme/Theme'
import { fonts, radius, space } from '../theme/tokens'

/*
 * What taps you, in two groups: Needs you (an agent waits on you: it
 * interrupts, with its buttons) and For your information (work moved on:
 * delivered quietly). With previews of how each looks on the lock screen,
 * and of the Live Activity that holds what's at work. The pushes carry only
 * ciphertext; the phone opens them itself, so the relay never reads one.
 */

type Category = {
  readonly key: string
  readonly title: string
  readonly detail: string
  readonly group: 'needs' | 'fyi'
  readonly on: boolean
}

const CATEGORIES: ReadonlyArray<Category> = [
  {
    key: 'permission',
    group: 'needs',
    on: true,
    title: 'Permissions',
    detail: 'With Deny and Allow on the notification; Allow asks for Face ID',
  },
  { key: 'question', group: 'needs', on: true, title: 'Questions', detail: 'Opens the question, its choices in hand' },
  { key: 'stuck', group: 'needs', on: true, title: 'Stuck', detail: 'A step that can’t go on without you' },
  {
    key: 'away',
    group: 'needs',
    on: true,
    title: 'Your Mac went away with calls waiting',
    detail: 'So an agent doesn’t wait on a sleeping Mac unseen',
  },
  { key: 'ready', group: 'fyi', on: true, title: 'Ready to accept', detail: 'Checks passed, a review drafted, a task finished' },
  { key: 'steps', group: 'fyi', on: false, title: 'Steps finishing', detail: 'Each implement and review step, as it reports' },
]

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text kind="label" ink="t3" style={{ paddingHorizontal: 4 }}>
        {title}
      </Text>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>{children}</Card>
    </View>
  )
}

/** A notification as the lock screen shows it, drawn here as a preview. */
function Banner({
  title,
  body,
  actions,
}: {
  readonly title: string
  readonly body: string
  readonly actions?: ReadonlyArray<{ label: string; lock?: boolean; strong?: boolean }>
}) {
  return (
    <View style={{ borderRadius: 22, backgroundColor: 'rgba(245,245,247,0.92)', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
        <View
          style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: '#141417', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text kind="headline" style={{ color: '#fff', fontFamily: fonts.bold }}>
            A
          </Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text kind="subMedium" style={{ color: '#141417', fontFamily: fonts.semibold }}>
              {title}
            </Text>
            <Text kind="caption" style={{ color: '#6f6f77' }}>
              now
            </Text>
          </View>
          <Text kind="sub" style={{ color: '#141417' }}>
            {body}
          </Text>
        </View>
      </View>
      {actions === undefined ? null : (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' }}>
          {actions.map((action, index) => (
            <View
              key={action.label}
              style={{
                flex: 1,
                flexDirection: 'row',
                gap: 5,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 11,
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: 'rgba(0,0,0,0.08)',
              }}
            >
              {action.lock === true ? <Lock width={13} height={13} color="#7a3ff0" strokeWidth={2} /> : null}
              <Text kind="subMedium" style={{ color: action.strong === true ? '#7a3ff0' : '#141417', fontFamily: fonts.semibold }}>
                {action.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function LockScreen() {
  return (
    <View
      style={{
        borderRadius: 36,
        padding: space.lg,
        gap: 10,
        backgroundColor: '#2a2350',
        experimental_backgroundImage: 'linear-gradient(160deg, #3b2f7a 0%, #1d2a5e 55%, #0f1530 100%)',
      }}
    >
      <Text kind="largeTitle" style={{ color: '#fff', textAlign: 'center', fontSize: 52, lineHeight: 58, fontFamily: fonts.semibold }}>
        14:32
      </Text>
      <Text kind="sub" style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginBottom: 8 }}>
        Tuesday 21 October
      </Text>
      <Banner
        title="Codex · meridian"
        body={'Run the database migration on staging?\nbun run db:migrate --env staging'}
        actions={[{ label: 'Deny' }, { label: 'Allow once', lock: true, strong: true }]}
      />
      <Banner
        title="Opus 5 · althar-site"
        body="Where should the shifts table fold into cards? Below 640px, below 768px, or scroll sideways."
      />
      <Banner title="billing-api · Ready to accept" body="Upgrade the Stripe SDK to v19: checks 14/14, +312 −198" />
    </View>
  )
}

function Island() {
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: '#000',
          borderRadius: 24,
          paddingHorizontal: 14,
          height: 38,
          minWidth: 220,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#8a95ff' }} />
          <Text kind="caption" style={{ color: '#fff' }}>
            4 at work
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#a68aff' }} />
          <Text kind="caption" style={{ color: '#fff' }}>
            3 need you
          </Text>
        </View>
      </View>
      <View style={{ alignSelf: 'stretch', backgroundColor: '#000', borderRadius: 28, padding: space.lg, gap: space.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text kind="subMedium" style={{ color: '#fff' }}>
            Balazs’s MacBook Pro
          </Text>
          <Text kind="caption" style={{ color: '#a68aff' }}>
            3 need you
          </Text>
        </View>
        {[
          ['Backfill invoice totals for 2024', 'Implementing · Opus 5 · 12m'],
          ['Dark mode for the docs pages', 'Reviewing · GPT-5.5 · 41m'],
        ].map(([title, detail]) => (
          <View key={title} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#8a95ff' }} />
            <View style={{ flex: 1 }}>
              <Text kind="sub" style={{ color: '#fff' }} lines={1}>
                {title}
              </Text>
              <Text kind="caption" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {detail}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default function Notifications() {
  const theme = useTheme()
  const [on, setOn] = useState<Readonly<Record<string, boolean>>>(Object.fromEntries(CATEGORIES.map((one) => [one.key, one.on])))
  const rows = (group: 'needs' | 'fyi') =>
    CATEGORIES.filter((one) => one.group === group).map((category, index) => (
      <View key={category.key}>
        {index === 0 ? null : <Divider inset={space.lg} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text kind="bodyMedium">{category.title}</Text>
            <Text kind="sub" ink="t3">
              {category.detail}
            </Text>
          </View>
          <Switch
            accessibilityLabel={category.title}
            value={on[category.key] ?? false}
            onValueChange={(value) => setOn({ ...on, [category.key]: value })}
            trackColor={{ true: theme.signalFill, false: theme.line3 }}
            thumbColor="#ffffff"
            {...{ activeThumbColor: '#ffffff' }}
          />
        </View>
      </View>
    ))
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
      <Group title="Needs you · interrupts">{rows('needs')}</Group>
      <Group title="For your information · quietly">{rows('fyi')}</Group>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
          <SignalDot />
          <Text kind="label" ink="t3">
            On the lock screen
          </Text>
        </View>
        <LockScreen />
      </View>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
          <LiveDot size={5} />
          <Text kind="label" ink="t3">
            While agents work
          </Text>
        </View>
        <View
          style={{ borderRadius: radius.lg, padding: space.lg, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.line2 }}
        >
          <Island />
        </View>
        <Text kind="sub" ink="t3" style={{ paddingHorizontal: 4 }}>
          A Live Activity shows counts and states only: its updates come from the relay, which mustn’t read more.
        </Text>
      </View>
    </ScrollView>
  )
}
