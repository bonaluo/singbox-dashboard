'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { getApiUrl } from '@/lib/api'

export { api } from '@/lib/api'

// 全局通知：通过 window 属性跨 Next.js chunk 通信
// 模块变量在 dev 模式下因代码分割而隔离，window 始终共享
export function notifySidebar(data: any) {
  if (typeof window !== 'undefined') {
    ;(window as any).__sidebarNotify?.(data)
  }
}

// Portal 组件：用 useState 管理，React 渲染到 layout 的 DOM 插槽
export default function SidebarStatus() {
  const [mounted, setMounted] = useState(false)
  const [current, setCurrent] = useState('...')
  const [running, setRunning] = useState(false)
  const [nodes, setNodes] = useState(0)
  const [version, setVersion] = useState('...')

  useEffect(() => { setMounted(true) }, [])

  // 注册 window 回调
  useEffect(() => {
    const handler = (d: any) => {
      if (d?.running !== undefined) setRunning(!!d.running)
      if (d?.current !== undefined) setCurrent(d.current)
      if (d?.total_nodes !== undefined) setNodes(d.total_nodes)
      if (d?.version !== undefined) setVersion(d.version)
      else if (d?.git_commit) setVersion('#' + d.git_commit)
    }
    ;(window as any).__sidebarNotify = handler
    return () => { delete (window as any).__sidebarNotify }
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

  if (!mounted) return null
  const slot = document.getElementById('sidebar-status-slot')
  const infoSlot = document.getElementById('sidebar-status-info-slot')
  const verSlot = document.getElementById('sidebar-version-slot')
  if (!slot && !infoSlot && !verSlot) return null

  return (
    <>
      {slot && createPortal(
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">{running ? '运行中' : '已停止'}</span>
        </div>,
        slot
      )}
      {infoSlot && createPortal(
        <div key={current}>
          <div className="truncate">当前: {current || '...'}</div>
          {nodes > 0 && <div>{nodes} 个节点</div>}
        </div>,
        infoSlot
      )}
      {verSlot && createPortal(
        <span>{version}</span>,
        verSlot
      )}
    </>
  )
}
