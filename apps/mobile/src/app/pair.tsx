import { CameraView, useCameraPermissions } from 'expo-camera'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CheckCircle, Laptop, QrCode, ShieldCheck } from 'iconoir-react-native'
import { useState } from 'react'
import { Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { PairedMac } from '../client/AltharClient'
import { DEMO_MAC } from '../client/demo/DemoClient'
import { useClient } from '../client/react'
import { Button, Card, Text } from '../components/ui'
import { tapDone } from '../lib/device'
import { useTheme } from '../theme/Theme'
import { radius, space } from '../theme/tokens'

/*
 * Pairing, from the phone's side (ADR-048): scan the code Althar shows in
 * Settings on the Mac; check that the four words on both screens match, so
 * nothing sat between them; done. The phone's key is made here and never
 * leaves it, so an agent on the Mac can't answer as you.
 */

type Step = 'scan' | 'verify' | 'done'

function Steps({ at }: { readonly at: Step }) {
  const theme = useTheme()
  const order: ReadonlyArray<Step> = ['scan', 'verify', 'done']
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {order.map((step) => (
        <View
          key={step}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            backgroundColor: order.indexOf(step) <= order.indexOf(at) ? theme.t1 : theme.line2,
          }}
        />
      ))}
    </View>
  )
}

function Scan({ onScanned }: { readonly onScanned: (code: string) => void }) {
  const theme = useTheme()
  const [permission, ask] = useCameraPermissions()
  const camera = Platform.OS !== 'web' && permission?.granted === true
  return (
    <View style={{ gap: space.lg }}>
      <Text kind="title">Pair with your Mac</Text>
      <Text kind="body" ink="t2">
        On your Mac, open Althar, then Settings › Phone › Pair a phone, and point this camera at the code.
      </Text>
      <View
        style={{
          aspectRatio: 1,
          borderRadius: radius.xl,
          overflow: 'hidden',
          backgroundColor: '#111',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {camera ? (
          <CameraView
            style={{ position: 'absolute', inset: 0 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => (data.startsWith('althar-pair:') ? onScanned(data) : undefined)}
          />
        ) : (
          <QrCode width={72} height={72} color="rgba(255,255,255,0.35)" />
        )}
        <View
          style={{
            position: 'absolute',
            width: '62%',
            aspectRatio: 1,
            borderRadius: radius.lg,
            borderWidth: 3,
            borderColor: 'rgba(255,255,255,0.9)',
          }}
        />
      </View>
      {Platform.OS !== 'web' && permission?.granted !== true ? (
        <Button label="Let Althar use the camera" tone="ink" onPress={() => void ask()} />
      ) : (
        <Button label="Use the demo Mac instead" tone="plain" onPress={() => onScanned('althar-pair:demo')} />
      )}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <ShieldCheck width={18} height={18} color={theme.ok} />
        <Text kind="sub" ink="t2" style={{ flex: 1 }}>
          Your work goes through Althar’s relay encrypted end to end: the relay carries it, and can’t read it.
        </Text>
      </View>
    </View>
  )
}

function Verify({ mac, onMatch, onMismatch }: { readonly mac: PairedMac; readonly onMatch: () => void; readonly onMismatch: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ gap: space.lg }}>
      <Text kind="title">Do these match your Mac?</Text>
      <Text kind="body" ink="t2">
        Your Mac shows four words too. If they’re the same, no one sits between the two.
      </Text>
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', paddingVertical: space.xl }}>
        {mac.words.map((word) => (
          <View
            key={word}
            style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: theme.pressed }}
          >
            <Text kind="headline" style={{ fontSize: 20, lineHeight: 26 }}>
              {word}
            </Text>
          </View>
        ))}
      </Card>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Laptop width={18} height={18} color={theme.t2} />
        <Text kind="sub" ink="t2">
          {mac.name}
        </Text>
      </View>
      <Button label="They match" tone="ink" onPress={onMatch} />
      <Button label="They don’t" tone="danger" onPress={onMismatch} />
    </View>
  )
}

export default function Pair() {
  const theme = useTheme()
  const router = useRouter()
  const client = useClient()
  const insets = useSafeAreaInsets()
  const { step: asked } = useLocalSearchParams<{ step?: string }>()
  const [step, setStep] = useState<Step>(asked === 'verify' ? 'verify' : asked === 'done' ? 'done' : 'scan')
  const [mac, setMac] = useState<PairedMac>(DEMO_MAC)
  const [refused, setRefused] = useState(false)
  return (
    <View style={{ flex: 1, backgroundColor: theme.page, paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, gap: space.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Steps at={step} />
        </View>
        <Button label="Close" tone="quiet" small onPress={() => router.back()} />
      </View>
      {step === 'scan' ? (
        <Scan
          onScanned={(code) =>
            void client.pair(code).then((paired) => {
              setMac(paired)
              setStep('verify')
            })
          }
        />
      ) : step === 'verify' ? (
        refused ? (
          <View style={{ gap: space.lg }}>
            <Text kind="title">Not paired</Text>
            <Text kind="body" ink="t2">
              The words differ, so something sat between your phone and your Mac. Nothing was shared. Try again on a network you trust.
            </Text>
            <Button label="Start again" tone="ink" onPress={() => (setRefused(false), setStep('scan'))} />
          </View>
        ) : (
          <Verify
            mac={mac}
            onMatch={() => {
              tapDone()
              setStep('done')
            }}
            onMismatch={() => {
              void client.unpair()
              setRefused(true)
            }}
          />
        )
      ) : (
        <View style={{ gap: space.lg, alignItems: 'flex-start' }}>
          <CheckCircle width={44} height={44} color={theme.ok} />
          <Text kind="title">Paired with {mac.name}</Text>
          <Text kind="body" ink="t2">
            Althar taps you here when an agent asks or work is ready, while your Mac is awake. Allowing asks for Face ID first; denying
            never does.
          </Text>
          <Button label="Done" tone="ink" onPress={() => router.replace('/')} />
        </View>
      )}
    </View>
  )
}
