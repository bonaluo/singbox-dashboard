'use client'

import { useEffect } from 'react'

// 自托管 twemoji JS（npm 导入），仅 SVG 图片走 maxcdn
export default function TwemojiLoader() {
  useEffect(() => {
    let observer: MutationObserver | null = null

    const apply = (tw: { parse: (node: HTMLElement, opts?: Record<string, unknown>) => void }) => {
      tw.parse(document.body, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://twemoji.maxcdn.com/v/14.0.2/',
      })
    }

    import('twemoji').then(({ default: tw }) => {
      apply(tw)
      // 监听 DOM 变化（SPA 路由切换、SSE 更新等）
      let timer: ReturnType<typeof setTimeout>
      observer = new MutationObserver(() => {
        clearTimeout(timer)
        timer = setTimeout(() => apply(tw), 200)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })

    return () => {
      observer?.disconnect()
    }
  }, [])

  return null
}
