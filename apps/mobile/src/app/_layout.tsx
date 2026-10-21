import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { DemoClient } from '../client/demo/DemoClient'
import { demoOptionsFromUrl } from '../client/demo/fromUrl'
import { ClientProvider } from '../client/react'
import { ThemeProvider, useTheme } from '../theme/Theme'
import { fonts } from '../theme/tokens'

/*
 * The app's root: its faces, its theme, and the client every screen asks.
 * Until the relay exists, the client is the demo's (src/client/demo).
 */

function Screens() {
  const theme = useTheme()
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.page },
          headerShadowVisible: false,
          headerTintColor: theme.t1,
          headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 16, color: theme.t1 },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: theme.page },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="call/[callId]" options={{ presentation: 'formSheet', title: 'Call', sheetGrabberVisible: true, sheetAllowedDetents: [0.75, 1] }} />
        <Stack.Screen name="new" options={{ presentation: 'modal', title: 'New task' }} />
        <Stack.Screen name="pair" options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="project/[projectId]" options={{ title: '' }} />
        <Stack.Screen name="task/[threadId]/index" options={{ title: '' }} />
        <Stack.Screen name="task/[threadId]/changes" options={{ title: 'Changes' }} />
        <Stack.Screen name="task/[threadId]/diff" options={{ title: '' }} />
      </Stack>
    </>
  )
}

export default function Root() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  })
  const [client] = useState(() => new DemoClient(demoOptionsFromUrl()))
  useEffect(() => () => client.dispose(), [client])
  if (!loaded) return null
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ClientProvider client={client}>
            <Screens />
          </ClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
