/*
 * Althar on phones, for althar.ai/pair and the files that let a pairing link
 * open the app (worker/appLinks.ts). Each is null until it exists: the page
 * shows a store's button only once its link is here, and the app-link files
 * are served only once their app is signed with these.
 */

export const PHONE_APP = {
  /** The App Store's page for Althar. */
  appStore: null as string | null,
  /** Google Play's page for Althar. */
  googlePlay: null as string | null,
  /** The Apple developer team that signs the iPhone app (apple-app-site-association). */
  appleTeamId: null as string | null,
  /** SHA-256 fingerprints of the certificate that signs the Android app, colon-separated (assetlinks.json). */
  androidCertificates: [] as ReadonlyArray<string>,
  /** Both apps' identifier (althar-mobile's app.json). */
  bundleId: 'dev.althar.mobile',
  /** The oldest each runs on (althar-mobile's app.json: iOS 17, Android API 33). */
  iosVersion: '17',
  androidVersion: '13',
}
