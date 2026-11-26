import appConfig from '../../app.json'

// Bundled with the JS, so each OTA shows the release it was built from; store and OTA checks keep the binary's installedAppVersion.
export const appReleaseVersion: string = appConfig.expo.version
