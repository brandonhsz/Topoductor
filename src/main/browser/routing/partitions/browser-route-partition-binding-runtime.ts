import { app } from 'electron'
import { join } from 'node:path'
import { BrowserRoutePartitionBindingStore } from './browser-route-partition-binding-store'

const BINDING_FILE_NAME = 'browser-route-partition-bindings.json'
const PARTITION_DATA_DIRECTORY_NAME = 'Partitions'
let bindingFilePathOverride: string | null = null
let activeTopoProfileId: string | null = null

export function configureBrowserRoutePartitionBindingsForTopoProfile(options: {
  topoProfileId: string
  profileDirectory: string
}): void {
  bindingFilePathOverride = join(options.profileDirectory, BINDING_FILE_NAME)
  activeTopoProfileId = options.topoProfileId
}

export function activeBrowserRoutePartitionTopoProfileId(): string | null {
  return activeTopoProfileId
}

export function routePartitionDataRoot(): string {
  return join(app.getPath('userData'), PARTITION_DATA_DIRECTORY_NAME)
}

export function currentBrowserRoutePartitionBindingFilePath(): string {
  return bindingFilePathOverride ?? join(app.getPath('userData'), BINDING_FILE_NAME)
}

export function currentBrowserRoutePartitionBindingStore(options?: {
  isPartitionRetained?: (partition: string) => boolean
}): BrowserRoutePartitionBindingStore {
  return new BrowserRoutePartitionBindingStore({
    filePath: currentBrowserRoutePartitionBindingFilePath(),
    partitionDataRoot: routePartitionDataRoot(),
    isPartitionRetained: options?.isPartitionRetained
  })
}
