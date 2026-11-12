import { createNativeChatFileHref } from '../../../../../shared/native-chat/native-chat-href-routing'
import { filePreviewForPath } from '../../../../../shared/file-preview/file-preview-kind'

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  alt?: string | null
  children?: MarkdownNode[]
}

// Why: only unambiguous locations; a bare `logo.png` in prose is usually talk about a file, not a result.
const PREVIEWABLE_PATH_PATTERN = /^(?:\/|\.{1,2}\/|[A-Za-z]:[\\/])\S/

function previewableImagePath(text: string | undefined): string | null {
  const path = text?.trim()
  if (!path || !PREVIEWABLE_PATH_PATTERN.test(path) || /\s/.test(path)) {
    return null
  }
  return filePreviewForPath(path)?.kind === 'image' ? path : null
}

function collectImagePaths(node: MarkdownNode, paths: string[]): void {
  if (node.type === 'inlineCode') {
    const path = previewableImagePath(node.value)
    if (path && !paths.includes(path)) {
      paths.push(path)
    }
    return
  }
  // Already an image: the reply chose how to show it.
  if (node.type === 'image' || node.type === 'imageReference') {
    return
  }
  for (const child of node.children ?? []) {
    collectImagePaths(child, paths)
  }
}

function addPreviews(parent: MarkdownNode): void {
  const children = parent.children
  if (!children) {
    return
  }
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if (child.type !== 'paragraph') {
      addPreviews(child)
      continue
    }
    const paths: string[] = []
    collectImagePaths(child, paths)
    if (paths.length === 0) {
      continue
    }
    children.splice(index + 1, 0, {
      type: 'paragraph',
      children: paths.map((path) => ({
        type: 'image',
        url: createNativeChatFileHref(path, 'literal'),
        alt: null
      }))
    })
    index++
  }
}

/** Show an inline, expandable preview under replies that name an image file by its path. */
export function remarkNativeChatMediaPathPreviews(): (tree: MarkdownNode) => void {
  return addPreviews
}
