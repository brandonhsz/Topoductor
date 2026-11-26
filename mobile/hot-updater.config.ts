import { existsSync } from 'node:fs'
import { d1Database, r2Storage } from '@hot-updater/cloudflare'
import { expo } from '@hot-updater/expo'
import { defineConfig } from 'hot-updater'
import { apiKeys, insights, remoteConfig } from 'hot-updater/plugins'

if (existsSync('.env.hotupdater')) {
  process.loadEnvFile('.env.hotupdater')
}

export default defineConfig({
  build: expo(),
  storage: r2Storage({
    bucketName: process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME!,
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
    credentials: {
      accessKeyId: process.env.HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY!
    }
  }),
  database: d1Database({
    databaseId: process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID!,
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID!,
    cloudflareApiToken: process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN!
  }),
  // Must match the deployed Worker's plugins so CLI and server agree.
  plugins: [apiKeys(), insights(), remoteConfig()],
  // Fastlane bumps the marketing version for every native release, so OTAs target an exact store version.
  updateStrategy: 'appVersion'
})
