'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen">
      <aside className="w-56 flex flex-col border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-lg font-bold">sing-box</h1>
          {/* Portal 插槽：由 page 组件注入状态内容 */}
          <div id="sidebar-status-slot" />
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

        {/* 另一个 Portal 插槽：底部版本号 */}
        <div id="sidebar-version-slot" className="p-2 border-t border-[var(--border)] text-[10px] text-gray-600 text-center" />
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
