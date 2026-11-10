#!/usr/bin/env node
import { buildSwiftCliHelper } from './swift-cli-helper-macos.mjs'

buildSwiftCliHelper({
  nativeDir: 'process-footprint-macos',
  executable: 'topo-process-footprint',
  argv: process.argv.slice(2)
})
