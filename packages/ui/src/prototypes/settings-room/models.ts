// Scrappy: everything the app's settings read and change, from the app's own hooks, as SettingsPanel reads them.
import { type AccountSignInModel, useAccountSignIn } from '../../../../../apps/desktop/src/renderer/features/accounts/useAccountSignIn'
import { type ConnectionsModel, useConnections } from '../../../../../apps/desktop/src/renderer/features/connections/useConnections'
import type { EdgeGlance } from '../../../../../apps/desktop/src/renderer/features/settings/EdgePicture'
import { type AgentsAtOnceModel, useAgentsAtOnce } from '../../../../../apps/desktop/src/renderer/features/settings/useAgentsAtOnce'
import { type AppIconModel, useAppIcon } from '../../../../../apps/desktop/src/renderer/features/settings/useAppIcon'
import { type CoAuthorModel, useCoAuthor } from '../../../../../apps/desktop/src/renderer/features/settings/useCoAuthor'
import { type EdgePlaceModel, useEdgePlace } from '../../../../../apps/desktop/src/renderer/features/settings/useEdgePlace'
import {
  type PostTeamReviewsModel,
  usePostTeamReviews,
} from '../../../../../apps/desktop/src/renderer/features/settings/usePostTeamReviews'
import type { StartModel } from '../../../../../apps/desktop/src/renderer/features/start/useStart'
import { useEditorList, useEditorPictures } from '../../../../../apps/desktop/src/renderer/shared/OpenIn'
import { type PreferencesModel, usePreferences } from '../../../../../apps/desktop/src/renderer/shared/usePreferences'
import { useSounds } from '../../../../../apps/desktop/src/renderer/shared/useSounds'
import { type UpdateModel, useUpdate } from '../../../../../apps/desktop/src/renderer/shared/useUpdate'

export interface Models {
  readonly start: StartModel
  readonly accounts: AccountSignInModel
  readonly connections: ConnectionsModel
  readonly appIcon: AppIconModel
  readonly edge: EdgePlaceModel
  readonly coAuthor: CoAuthorModel | null
  readonly atOnce: AgentsAtOnceModel | null
  readonly postTeamReviews: PostTeamReviewsModel | null
  readonly preferences: PreferencesModel
  readonly editors: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly pictures: Readonly<Record<string, string>>
  readonly sounds: { readonly list: ReadonlyArray<string>; readonly play: (sound: string) => void }
  readonly update: UpdateModel
  readonly glance: EdgeGlance | undefined
}

export const useModels = (start: StartModel, open: boolean, glance: EdgeGlance | undefined): Models => ({
  start,
  accounts: useAccountSignIn(start),
  connections: useConnections(),
  appIcon: useAppIcon(),
  edge: useEdgePlace(open),
  coAuthor: useCoAuthor(),
  atOnce: useAgentsAtOnce(),
  postTeamReviews: usePostTeamReviews(),
  preferences: usePreferences(),
  editors: useEditorList(),
  pictures: useEditorPictures(),
  sounds: useSounds(),
  update: useUpdate(),
  glance,
})
