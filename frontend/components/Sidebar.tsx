'use client'

function getApiUrl() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('apiUrl')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API || 'http://localhost:9092'
}

export function api(endpoint: string, options?: RequestInit) {
  const base = getApiUrl()
  return fetch(`${base}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(r => r.json())
}
