'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSSE } from '@/hooks/useSSE'

function getApiUrl() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('apiUrl')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API || 'http://10.31.3.87:9092'
}

const navItems = [
  { href: '/', label: '首页', icon: '🏠' },
  { href: '/proxies', label: '节点', icon: '🔗' },
  { href: '/subscriptions', label: '订阅', icon: '📡' },
  { href: '/rules', label: '规则', icon: '📋' },
  { href: '/groups', label: '出站组', icon: '📦' },
  { href: '/config', label: '配置', icon: '📄' },
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

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { status } = useSSE(['status'])

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-lg font-bold">sing-box</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-400">{status?.running ? '运行中' : '已停止'}</span>
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

        {status?.current && (
          <div className="p-3 border-t border-[var(--border)] text-xs text-gray-400">
            <div className="truncate">当前: {status.current}</div>
            {status.total_nodes > 0 && <div>{status.total_nodes} 个节点</div>}
          </div>
        )}
        <div className="p-2 border-t border-[var(--border)] text-[10px] text-gray-600 text-center">
          {status?.git_commit ? `#${status.git_commit}` : ''}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
