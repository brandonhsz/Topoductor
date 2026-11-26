import { HotUpdater, insights } from '@hot-updater/react-native'

const baseURL = process.env.EXPO_PUBLIC_HOT_UPDATER_BASE_URL
const apiKey = process.env.EXPO_PUBLIC_HOT_UPDATER_API_KEY

// Builds without the OTA env (local dev, forks) skip updates instead of failing launch.
export const hotUpdater =
  baseURL && apiKey
    ? HotUpdater.init({
        baseURL,
        requestHeaders: { 'x-api-key': apiKey },
        plugins: [insights()],
        onError: (error) => console.warn('[hot-updater]', error)
      })
    : null
