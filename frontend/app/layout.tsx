import type { Metadata } from 'next'
import Sidebar from '@/components/Sidebar'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'sing-box Dashboard',
  description: 'sing-box proxy management dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <Sidebar>{children}</Sidebar>
        <Script src="https://cdn.jsdelivr.net/npm/twemoji@14/dist/twemoji.min.js" />
        <Script id="twemoji-init" strategy="afterInteractive">
          {`if (window.twemoji) {
            twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
            setInterval(() => twemoji.parse(document.body, { folder: 'svg', ext: '.svg' }), 3000);
          }`}
        </Script>
      </body>
    </html>
  )
}
