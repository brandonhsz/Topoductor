import { useContext, useEffect, useRef, useState } from 'react'
import { Film, Play } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { basename } from '@/lib/path'
import { chatImageAccess } from '@/lib/local-file-access'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { getRelativePathInsideWorktree } from '@/runtime/files/runtime-file-routing'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import { NativeChatMarkdownImageOwnerContext } from '../images/native-chat-markdown-image-owner'
import { observeTranscriptVisibility } from '../images/native-chat-image-visibility'
import { resolveNativeChatFileLink } from '../../links/actions/native-chat-file-link'
import { useNativeChatFileLinkClick } from '../../links/actions/use-native-chat-file-link-click'

const MEDIA_ACCESS = chatImageAccess()

/** A video a reply names: an inline muted preview that plays large in a dialog. */
export function NativeChatMarkdownVideo({
  src,
  alt
}: {
  src: string
  alt?: string
}): React.JSX.Element {
  const t = useTranslate()
  const owner = useContext(NativeChatMarkdownImageOwnerContext)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [near, setNear] = useState(false)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<{ key: string; url: string | null }>()
  const runtimeContext = owner?.runtimeContext ?? null
  const fileLinkContext =
    runtimeContext?.worktreePath && owner?.fileLinkContext
      ? {
          ...owner.fileLinkContext,
          worktreeId: runtimeContext.worktreeId ?? owner.fileLinkContext.worktreeId,
          worktreePath: runtimeContext.worktreePath,
          runtimeEnvironmentId: runtimeTargetEnvironmentId(runtimeContext.target)
        }
      : null
  const target = resolveNativeChatFileLink(src, fileLinkContext)
  const absolutePath = target?.absolutePath ?? null
  const onFileLinkClick = useNativeChatFileLinkClick(fileLinkContext)
  const visible = owner?.isVisible ?? true
  const loadKey =
    absolutePath && runtimeContext ? [absolutePath, runtimeContext.worktreeId].join('\0') : ''

  useEffect(() => {
    const element = triggerRef.current
    return element ? observeTranscriptVisibility(element, setNear) : undefined
  }, [])

  useEffect(() => {
    if (
      !loadKey ||
      !absolutePath ||
      !runtimeContext ||
      !(near || open) ||
      loaded?.key === loadKey
    ) {
      return
    }
    let cancelled = false
    void readRuntimeFileContent({
      target: runtimeContext.target,
      filePath: absolutePath,
      relativePath:
        getRelativePathInsideWorktree(runtimeContext.worktreePath, absolutePath) ?? undefined,
      worktreeId: runtimeContext.worktreeId ?? undefined,
      connectionId: runtimeContext.connectionId,
      expectedExternalSshTargetId: runtimeContext.expectedExternalSshTargetId,
      expectedEnvironmentPairingRevision: runtimeContext.expectedEnvironmentPairingRevision,
      access: MEDIA_ACCESS,
      pageOversizedBinary: true
    })
      .then((result) => {
        if (!cancelled) {
          setLoaded({ key: loadKey, url: result.mediaUrl ?? null })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ key: loadKey, url: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [absolutePath, loadKey, loaded?.key, near, open, runtimeContext])

  const mediaUrl = loaded?.key === loadKey ? loaded.url : undefined
  const title =
    alt?.trim() ||
    (absolutePath ? basename(absolutePath) : '') ||
    t('components.native-chat.videoPreview.video', 'Video')
  if (!visible && open) {
    setOpen(false)
  }

  // Why: hosts that cannot stream the file still let the user open it in the editor's player.
  if (mediaUrl === null) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="my-3 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={(event) => onFileLinkClick?.(event, src)}
      >
        <Film className="size-4 shrink-0" />
        <span className="truncate">{title}</span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('components.native-chat.videoPreview.play', 'Play video: {{title}}', {
          title
        })}
        className="group relative my-3 block max-w-full cursor-pointer overflow-hidden rounded-md border-0 bg-transparent p-0 outline outline-1 outline-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            onFileLinkClick?.(event, src)
            return
          }
          setOpen(true)
        }}
      >
        {mediaUrl ? (
          <video
            src={mediaUrl}
            muted
            playsInline
            preload="metadata"
            className="pointer-events-none block max-h-96 max-w-full object-contain"
          />
        ) : (
          <span className="flex h-40 w-72 max-w-full items-center justify-center bg-muted text-sm text-muted-foreground">
            {title}
          </span>
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
          <span className="flex size-12 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
      </button>
      <Dialog open={open && visible} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[90dvh] w-[90vw] max-w-[90vw] overflow-hidden sm:max-w-[90vw]"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="flex h-full min-h-0 items-center justify-center">
            {mediaUrl ? (
              <video
                src={mediaUrl}
                controls
                autoPlay
                playsInline
                aria-label={title}
                className="max-h-full max-w-full rounded-md"
              />
            ) : (
              <span className="text-sm text-muted-foreground">{title}</span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
