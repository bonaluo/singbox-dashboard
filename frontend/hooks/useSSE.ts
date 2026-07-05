'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { getApiUrl } from '@/lib/api'

interface SSEData {
  status: any
  connections: any
  logs: { content: string }
}

export function useSSE(types: string[]): SSEData {
  const [status, setStatus] = useState<any>(null)
  const [connections, setConnections] = useState<any>(null)
  const [logs, setLogs] = useState<{ content: string }>({ content: '' })
  const esRef = useRef<EventSource | null>(null)
  const typesKey = types.sort().join(',')

  const connect = useCallback(() => {
    const base = getApiUrl()
    const url = `${base}/api/events?types=${encodeURIComponent(typesKey)}`
    const es = new EventSource(url)

    es.addEventListener('status', (e: MessageEvent) => {
      try { setStatus(JSON.parse(e.data)) } catch {}
    })
    es.addEventListener('connections', (e: MessageEvent) => {
      try { setConnections(JSON.parse(e.data)) } catch {}
    })
    es.addEventListener('logs', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data)
        setLogs(prev => ({ content: (prev.content + (d.content || '')).slice(-50000) }))
      } catch {}
    })

    es.onerror = () => {}

    esRef.current = es
  }, [typesKey])

  useEffect(() => {
    connect()
    return () => { esRef.current?.close() }
  }, [connect])

  return { status, connections, logs }
}
