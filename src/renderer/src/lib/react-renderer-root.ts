import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  topoRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.topoRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.topoRendererRoot = root
  }
  return root
}
