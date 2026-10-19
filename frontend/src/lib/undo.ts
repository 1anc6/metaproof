import { toast } from 'sonner'
import { clearHistory, removeFromHistory, restoreHistory } from './history'

// Deleting is instant and undoable, rather than guarded by a confirm dialog.
export function removeWithUndo(jobId: string, filename: string) {
  const removed = removeFromHistory(jobId)
  toast(`Removed ${filename}`, { action: { label: 'Undo', onClick: () => restoreHistory(removed) } })
}

export function clearWithUndo() {
  const removed = clearHistory()
  if (removed.length === 0) return
  toast(`Cleared ${removed.length} ${removed.length === 1 ? 'analysis' : 'analyses'} from this device`, {
    description: 'Reports stay available by link.',
    action: { label: 'Undo', onClick: () => restoreHistory(removed) },
  })
}
