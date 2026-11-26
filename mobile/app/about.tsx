import { Linking, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import AboutScreen from '../src/settings/about-screen'
import { appReleaseVersion } from '../src/app-update/app-release-version'

// Release version travels with the JS bundle (OTA); the build id is the native binary's iOS buildNumber or Android versionCode.
function getVersionLabel(): string {
  const version = appReleaseVersion
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : String(Constants.expoConfig?.android?.versionCode ?? '')
  return build ? `v${version} (${build})` : `v${version}`
}

export default function NativeAboutRoute() {
  const router = useRouter()
  return (
    <AboutScreen
      onBack={() => router.back()}
      openExternal={(url) => Linking.openURL(url)}
      versionLabel={getVersionLabel()}
    />
  )
}
