import * as Notifications from 'expo-notifications'
import type { HomeCall } from '@althar/contracts'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { useClient, useHome } from '../client/react'
import { callNotice, CATEGORIES, newCalls, notDelivered, responseTo, type Notice, type NoticeData } from './notices'

/*
 * Notifications, wired to the system: the categories and their buttons,
 * what a tap does, and Deny answered without opening the app. Once the relay
 * exists, pushes arrive encrypted and the notification service extension
 * opens them; until then, the demo taps the person itself when a call
 * arrives, so the flow can be tried on a phone.
 */

const native = Platform.OS === 'ios' || Platform.OS === 'android'

if (native) {
  Notifications.setNotificationHandler({
    // While the app is open, a call still shows: the person may be on another screen.
    handleNotification: async (notification) => {
      const needs = (notification.request.content.data as { group?: string } | null)?.group !== 'fyi'
      return { shouldShowBanner: needs, shouldShowList: true, shouldPlaySound: needs, shouldSetBadge: true }
    },
  })
}

const registerCategories = async () => {
  for (const category of Object.values(CATEGORIES)) {
    await Notifications.setNotificationCategoryAsync(
      category.id,
      category.actions.map((action) => ({
        identifier: action.id,
        buttonTitle: action.title,
        options: { opensAppToForeground: action.opens, isDestructive: action.destructive, isAuthenticationRequired: false },
      })),
    )
  }
}

/** Shows a notice now, as a push would. */
export const show = (notice: Pick<Notice, 'title' | 'body' | 'group'> & Partial<Pick<Notice, 'category' | 'thread' | 'data'>>) =>
  native
    ? Notifications.scheduleNotificationAsync({
        content: {
          title: notice.title,
          body: notice.body,
          data: { ...notice.data, group: notice.group },
          ...(notice.category === undefined ? {} : { categoryIdentifier: notice.category }),
          ...(notice.thread == null ? {} : { threadIdentifier: notice.thread }),
          interruptionLevel: notice.group === 'needs' ? 'timeSensitive' : 'passive',
        },
        trigger: null,
      })
    : Promise.resolve(null)

/** Asks the person to let Althar tap them: once paired, as the research says to, not on first launch. */
export const askToNotify = async (): Promise<boolean> => {
  if (!native) return false
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
  return asked.granted
}

/** What a tap, or a button, does: Deny answers here; everything else opens where it belongs. Phones only: the web has no such response. */
function Responses() {
  const client = useClient()
  const router = useRouter()
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    if (last == null) return
    const data = last.notification.request.content.data as NoticeData | null
    if (data?.kind === undefined) return
    const response = responseTo(last.actionIdentifier, data)
    if (response.kind === 'deny') {
      client
        .answer({ attentionId: response.attentionId, decision: 'reject' })
        .catch((error: unknown) => void show(notDelivered(error instanceof Error ? error.message : 'no answer')))
    } else if (response.kind === 'open') {
      router.push(response.href as never)
    }
  }, [last, client, router])
  return null
}

export function NotificationsBridge({ demo }: { readonly demo: boolean }) {
  const home = useHome()
  const seen = useRef<ReadonlyArray<HomeCall> | null>(null)

  useEffect(() => {
    if (native) void registerCategories()
  }, [])

  // The demo taps the person for each call that arrives after it started, as the relay's pushes will.
  useEffect(() => {
    const calls = home.data?.calls
    if (calls === undefined) return
    if (demo && seen.current !== null) {
      for (const call of newCalls(seen.current, calls)) {
        const project = home.data?.projects.find((one) => one.id === call.projectId)?.name ?? null
        void show(callNotice(call, project))
      }
    }
    seen.current = calls
  }, [demo, home.data])

  return native ? <Responses /> : null
}
