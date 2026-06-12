import type { Metadata } from 'next'
import SidebarShell from '@/components/SidebarShell'
import Script from 'next/script'
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
        <Script id="twemoji-loader" src="/twemoji-init.js" strategy="afterInteractive" />
      </body>
    </html>
  )
}
