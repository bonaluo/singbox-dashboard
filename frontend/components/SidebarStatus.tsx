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

// 全局通知：通过 CustomEvent 跨 Next.js chunk 通信
// 不使用模块级变量（代码分割后不同 chunk 不共享闭包）
export function notifySidebar(data: any) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sidebar-status-update', { detail: data }))
  }
}

// Portal 组件：渲染到 layout 的 DOM 插槽
// 只在 layout.tsx 中渲染一次，不要在其他页面重复渲染
export default function SidebarStatus() {
  const [current, setCurrent] = useState('...')
  const [running, setRunning] = useState(false)
  const [nodes, setNodes] = useState(0)
  const [version, setVersion] = useState('')

  // 监听跨页面通知（CustomEvent，跨 Next.js chunk 安全）
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d?.running !== undefined) setRunning(!!d.running)
      if (d?.current !== undefined) setCurrent(d.current)
      if (d?.total_nodes !== undefined) setNodes(d.total_nodes)
      if (d?.version !== undefined) setVersion(d.version)
      else if (d?.git_commit) setVersion('#' + d.git_commit)
    }
    window.addEventListener('sidebar-status-update', handler)
    return () => window.removeEventListener('sidebar-status-update', handler)
  }, [])

  // 轮询状态
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const base = getApiUrl()
        const r = await fetch(`${base}/api/status`, { cache: 'no-store' })
        const d = await r.json()
        if (cancelled) return
        if (d?.ok && d?.data) {
          const s = d.data
          setRunning(!!s.running)
          setCurrent(s.current || '')
          setNodes(s.total_nodes || 0)
          setVersion(s.version || (s.git_commit ? '#' + s.git_commit : ''))
        }
      } catch {}
    }
    poll() // 立即执行
    const timer = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const slot = typeof document !== 'undefined' ? document.getElementById('sidebar-status-slot') : null
  const infoSlot = typeof document !== 'undefined' ? document.getElementById('sidebar-status-info-slot') : null
  const verSlot = typeof document !== 'undefined' ? document.getElementById('sidebar-version-slot') : null
  if (!slot && !infoSlot && !verSlot) return null

  return (
    <>
      {/* 标题下方：运行指示灯 */}
      {slot && createPortal(
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">{running ? '运行中' : '已停止'}</span>
        </div>,
        slot
      )}

      {/* 左下角：当前节点 + 节点数 */}
      {infoSlot && createPortal(
        <>
          <div className="truncate">当前: {current || '...'}</div>
          {nodes > 0 && <div>{nodes} 个节点</div>}
        </>,
        infoSlot
      )}

      {/* 左下角底部：版本号 */}
      {verSlot && createPortal(
        <span>{version || '...'}</span>,
        verSlot
      )}
    </>
  )
}
