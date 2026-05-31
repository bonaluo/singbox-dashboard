'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

function getApiUrl() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('apiUrl')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API || 'http://10.31.3.87:9092'
}

interface SSEData {
  status: any
  connections: any
  logs: { content: string }
}

/**
 * useSSE — 通过 EventSource 订阅服务端事件，替代轮询
 *
 * EventSource 自带自动重连：容器重启后浏览器会在几秒内自动恢复连接。
 *
 * @param types 订阅的事件类型数组，如 ['status', 'connections', 'logs']
 * @returns 各事件类型的最新数据
 */
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

    es.onerror = () => {
      // EventSource 会自动重连，无需手动处理
    }

    esRef.current = es
  }, [typesKey])

  useEffect(() => {
    connect()
    return () => {
      esRef.current?.close()
    }
  }, [connect])

  return { status, connections, logs }
}
