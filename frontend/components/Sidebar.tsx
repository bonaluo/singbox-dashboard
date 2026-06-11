'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

function getApiUrl() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('apiUrl')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API || 'http://localhost:9092'
}

const navItems = [
  { href: '/', label: '首页', icon: '🏠' },
  { href: '/proxies', label: '节点', icon: '🔗' },
  { href: '/subscriptions', label: '订阅', icon: '📡' },
  { href: '/rules', label: '规则', icon: '📋' },
  { href: '/groups', label: '出站组', icon: '📦' },
  { href: '/connections', label: '连接', icon: '🔌' },
  { href: '/logs', label: '日志', icon: '📜' },
  { href: '/settings', label: '设置', icon: '⚙️' },
]

export function api(endpoint: string, options?: RequestInit) {
  const base = getApiUrl()
  return fetch(`${base}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(r => r.json())
}

// 绕过 Next.js static generation 下 React state 不更新的问题，直接操作 DOM
let _current = ''
let _running = false
let _nodes = 0
let _version = '...'

function updateDOM() {
  const aside = document.querySelector('aside')
  if (!aside) return
  const el = aside.querySelector('[data-status-current]')
  if (el) el.textContent = _current || '...'
  const el2 = aside.querySelector('[data-status-nodes]')
  if (el2 && _nodes > 0) el2.textContent = `${_nodes} 个节点`
  const el3 = aside.querySelector('[data-status-running]')
  if (el3) el3.textContent = _running ? '运行中' : '已停止'
  const dot = aside.querySelector('[data-status-dot]')
  if (dot) dot.className = `w-2 h-2 rounded-full ${_running ? 'bg-green-400' : 'bg-red-500'}`
  const el4 = aside.querySelector('[data-status-version]')
  if (el4) el4.textContent = _version
}

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const base = getApiUrl()
        const r = await fetch(`${base}/api/status`, { cache: 'no-store' })
        const d = await r.json()
        if (d?.ok && d?.data) {
          _current = d.data.current || ''
          _running = !!d.data.running
          _nodes = d.data.total_nodes || 0
          _version = d.data.version || (`#${d.data.git_commit}`) || '...'
          updateDOM()
        }
      } catch {}
    }, 3000)
    // 立即执行一次
    ;(async () => {
      try {
        const base = getApiUrl()
        const r = await fetch(`${base}/api/status`, { cache: 'no-store' })
        const d = await r.json()
        if (d?.ok && d?.data) {
          _current = d.data.current || ''
          _running = !!d.data.running
          _nodes = d.data.total_nodes || 0
          _version = d.data.version || (`#${d.data.git_commit}`) || '...'
          updateDOM()
        }
      } catch {}
    })()
    return () => clearInterval(poll)
  }, [])

  return (
    <div className="flex h-screen">
      <aside className="w-56 flex flex-col border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-lg font-bold">sing-box</h1>
          <div className="flex items-center gap-2 mt-1">
            <span data-status-dot className="w-2 h-2 rounded-full bg-red-500" />
            <span data-status-running className="text-xs text-gray-400">已停止</span>
          </div>
        </div>

        <nav className="flex-1 p-2">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                pathname === item.href
                  ? 'bg-[#1d9bf0]/20 text-[#1d9bf0]'
                  : 'text-gray-300 hover:bg-[var(--surface-hover)]'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--border)] text-xs text-gray-400">
          <div className="truncate">当前: <span data-status-current>...</span></div>
          <div data-status-nodes></div>
        </div>
        <div className="p-2 border-t border-[var(--border)] text-[10px] text-gray-600 text-center">
          <span data-status-version>...</span>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
