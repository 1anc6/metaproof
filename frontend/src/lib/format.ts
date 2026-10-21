export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  // Pick the unit after rounding, so 1,048,575 bytes reads "1.0 MB", not "1024.0 KB".
  const kb = (bytes / 1024).toFixed(1)
  if (Number(kb) < 1024) return `${kb} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatType(mime: string): string {
  return mime.replace('image/', '').toUpperCase().replace('JPEG', 'JPG')
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function formatWhen(iso: string): string {
  const then = new Date(iso)
  const minutes = Math.round((then.getTime() - Date.now()) / 60000)
  if (Math.abs(minutes) < 1) return 'Just now'
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return relative.format(days, 'day')
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortHash(sha: string): string {
  return `${sha.slice(0, 8)}…${sha.slice(-6)}`
}
