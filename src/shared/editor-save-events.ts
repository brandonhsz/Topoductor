export const TOPO_EDITOR_SAVE_DIRTY_FILES_EVENT = 'topo:editor-save-dirty-files'
export const TOPO_EDITOR_PREPARE_HOT_EXIT_EVENT = 'topo:editor-prepare-hot-exit'

export type EditorSaveDirtyFilesDetail = {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail
