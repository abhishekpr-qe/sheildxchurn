declare global {
  interface Window { API_BASE?: string }
}

export const API_BASE = window.API_BASE || ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
