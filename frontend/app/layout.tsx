import type { Metadata } from 'next'
import SidebarShell from '@/components/SidebarShell'
import SidebarStatus from '@/components/SidebarStatus'
import './globals.css'

export const metadata: Metadata = {
  title: 'sing-box Dashboard',
  description: 'sing-box proxy management dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <SidebarShell>{children}</SidebarShell>
        <SidebarStatus />
      </body>
    </html>
  )
}
