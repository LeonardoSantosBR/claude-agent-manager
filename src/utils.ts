export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.floor(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)} h`
  const days = hours / 24
  if (days < 30) return `${Math.floor(days)} d`
  return new Date(timestamp).toLocaleDateString()
}

/** Shortens long paths to …/last/three/segments. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}
