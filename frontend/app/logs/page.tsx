'use client'

import { api } from '@/components/Sidebar'
import { useState, useEffect, useCallback, useRef } from 'react'

// sing-box 日志级别
const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'PANIC']

const LEVEL_COLORS: Record<string, string> = {
  TRACE: 'text-gray-500',
  DEBUG: 'text-blue-400',
  INFO: 'text-green-400',
  WARN: 'text-yellow-400',
  ERROR: 'text-red-400',
  FATAL: 'text-red-500',
  PANIC: 'text-purple-400',
}

// 去掉 ANSI 转义码 (如 [31m, [0m, [36m 等)
function stripAnsi(text: string): string {
  // \x1b[...m 格式的标准 ANSI 码
  // 以及 sing-box 日志中不带 \x1b 前缀的裸转义码]
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')     // 标准 ANSI: ESC[...m
    .replace(/\[[0-9;]*m/g, '')          // 裸转义码: [31m, [0m, [36m 等
    .replace(/\[[0-9;]*\[/g, '[')         // 修复误删: [[ → [
}

// 尝试从 sing-box 日志行中提取级别
// 日志格式: [时间戳 ]LEVEL[offset] message  (如 2026-05-31 09:13:47 INFO[0000] ...)
// 或者无时间戳: LEVEL[offset] message
function detectLevel(line: string): string | null {
  // 先去掉 ANSI 码再检测
  const clean = stripAnsi(line)
  for (const lv of LOG_LEVELS) {
    // 匹配: 行首 LEVEL[ 或 时间戳 LEVEL[ (如 "INFO[0000]" 或 "2026-... INFO[0000]")
    if (clean.startsWith(lv + '[') || clean.includes(' ' + lv + '[') ||
        clean.includes('[' + lv + ']') || clean.includes(' ' + lv + ' ')) {
      return lv
    }
  }
  return null
}

export default function LogsPage() {
  const [content, setContent] = useState('')
  const [logPath, setLogPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tail, setTail] = useState(500)
  const [filter, setFilter] = useState('')
  const [showLevels, setShowLevels] = useState<Set<string>>(new Set(LOG_LEVELS))
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused

  // 初始加载完整日志
  const fetchLogs = useCallback(async () => {
    try {
      const r = await api(`/api/logs?tail=${tail}`)
      if (r.ok) {
        setContent(r.data.content || '')
        setLogPath(r.data.path || '')
        setError('')
      } else {
        setError(r.error || '读取日志失败')
      }
    } catch {
      setError('无法连接后端')
    } finally {
      setLoading(false)
    }
  }, [tail])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // SSE 增量推送 — 独立 EventSource，直接追加增量；paused 用 ref 避免重连
  useEffect(() => {
    const base = typeof window !== 'undefined'
      ? (localStorage.getItem('apiUrl') || process.env.NEXT_PUBLIC_API || 'http://localhost:9092')
      : ''
    const es = new EventSource(`${base}/api/events?types=logs`)
    es.addEventListener('logs', (e: MessageEvent) => {
      if (pausedRef.current) return
      try {
        const d = JSON.parse(e.data)
        if (d.content) {
          setContent(prev => (prev + d.content).slice(-100000))
        }
      } catch {}
    })
    return () => es.close()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, autoScroll])

  const lines = content.split('\n').filter(line => {
    // 级别过滤
    if (showLevels.size < LOG_LEVELS.length) {
      const lv = detectLevel(line)
      if (lv && !showLevels.has(lv)) return false
    }
    // 文本过滤
    if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const toggleLevel = (lv: string) => {
    setShowLevels(prev => {
      const next = new Set(prev)
      if (next.has(lv)) next.delete(lv)
      else next.add(lv)
      return next
    })
  }

  const handleScroll = () => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    setAutoScroll(atBottom)
  }

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">📜 日志</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500" title={logPath}>
            {logPath.split('/').pop() || '-'}
          </span>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs text-gray-500">{lines.length} 行</span>
          <button onClick={fetchLogs} className="text-xs text-gray-400 hover:text-white transition-colors">
            🔄
          </button>
          <button
            onClick={() => setPaused(!paused)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              paused ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
            }`}
          >
            {paused ? '⏸ 已暂停' : '▶ 实时'}
          </button>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* 级别过滤 */}
        <div className="flex items-center gap-1">
          {LOG_LEVELS.map(lv => (
            <button
              key={lv}
              onClick={() => toggleLevel(lv)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                showLevels.has(lv)
                  ? `${LEVEL_COLORS[lv]} bg-current/10`
                  : 'text-gray-600 bg-gray-800'
              }`}
            >
              {lv}
            </button>
          ))}
        </div>
        {/* 搜索 */}
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="搜索日志..."
          className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs flex-1 min-w-[200px]"
        />
        {/* 行数 */}
        <select
          value={tail}
          onChange={e => setTail(Number(e.target.value))}
          className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs"
        >
          <option value={200}>200 行</option>
          <option value={500}>500 行</option>
          <option value={1000}>1000 行</option>
          <option value={2000}>2000 行</option>
          <option value={0}>全部</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 mb-4">
          {error}
        </div>
      )}

      {loading && lines.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl p-8 border border-[var(--border)] text-center text-gray-400">
          加载中...
        </div>
      )}

      {/* 日志内容 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-auto p-4 max-h-[75vh]"
      >
        {lines.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-12">
            {content ? '无匹配的日志行' : '暂无日志'}
          </div>
        ) : (
          <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-all">
            {lines.map((line, i) => {
              const lv = detectLevel(line)
              const color = lv ? LEVEL_COLORS[lv] : 'text-gray-400'
              const clean = stripAnsi(line)
              return (
                <div key={i} className={`${color} hover:bg-white/5`}>
                  {clean}
                </div>
              )
            })}
          </pre>
        )}
      </div>
    </div>
  )
}
