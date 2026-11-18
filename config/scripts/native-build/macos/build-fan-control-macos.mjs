#!/usr/bin/env node
import { buildSwiftCliHelper } from './swift-cli-helper-macos.mjs'

buildSwiftCliHelper({
  nativeDir: 'fan-control-macos',
  executable: 'topo-fan-control',
  argv: process.argv.slice(2)
})
