'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

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

// 全局函数：page 组件切换后立刻调
let _notify: ((d: any) => void) | null = null
export function notifySidebar(data: any) {
  _notify?.(data)
}

// Portal 组件：用 useState 管理，React 渲染到 layout 的 DOM 插槽
export default function SidebarStatus() {
  const [current, setCurrent] = useState('...')
  const [running, setRunning] = useState(false)
  const [nodes, setNodes] = useState(0)
  const [version, setVersion] = useState('...')

  // 注册全局通知
  useEffect(() => {
    _notify = (d: any) => {
      if (d?.running !== undefined) setRunning(!!d.running)
      if (d?.current !== undefined) setCurrent(d.current)
      if (d?.total_nodes !== undefined) setNodes(d.total_nodes)
      if (d?.version !== undefined) setVersion(d.version)
      else if (d?.git_commit) setVersion(`#${d.git_commit}`)
    }
    return () => { _notify = null }
  }, [])

  // 轮询兜底
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const base = getApiUrl()
        const r = await fetch(`${base}/api/status`, { cache: 'no-store' })
        const d = await r.json()
        if (d?.ok && d?.data) {
          const s = d.data
          setRunning(!!s.running)
          setCurrent(s.current || '')
          setNodes(s.total_nodes || 0)
          setVersion(s.version || `#${s.git_commit}` || '...')
        }
      } catch {}
    }, 1000)
    // immediate
    ;(async () => {
      try {
        const base = getApiUrl()
        const r = await fetch(`${base}/api/status`, { cache: 'no-store' })
        const d = await r.json()
        if (d?.ok && d?.data) {
          const s = d.data
          setRunning(!!s.running)
          setCurrent(s.current || '')
          setNodes(s.total_nodes || 0)
          setVersion(s.version || `#${s.git_commit}` || '...')
        }
      } catch {}
    })()
    return () => clearInterval(poll)
  }, [])

  const slot = typeof document !== 'undefined' ? document.getElementById('sidebar-status-slot') : null
  const verSlot = typeof document !== 'undefined' ? document.getElementById('sidebar-version-slot') : null
  if (!slot && !verSlot) return null

  return (
    <>
      {slot && createPortal(
        <>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-400">{running ? '运行中' : '已停止'}</span>
          </div>
          <div className="p-3 border-t border-[var(--border)] text-xs text-gray-400">
            <div className="truncate">当前: {current || '...'}</div>
            {nodes > 0 && <div>{nodes} 个节点</div>}
          </div>
        </>,
        slot
      )}
      {verSlot && createPortal(
        <span>{version}</span>,
        verSlot
      )}
    </>
  )
}
