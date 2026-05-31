'use client'

import { api } from '@/components/Sidebar'
import { useState, useEffect, useCallback } from 'react'

export default function ConfigPage() {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fetchConfig = useCallback(() => {
    setLoading(true)
    api('/api/config')
      .then(r => {
        if (r.ok) {
          setConfig(r.data)
          setError('')
        } else {
          setError(r.error || '获取配置失败')
        }
      })
      .catch(() => setError('无法连接到后端'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const toggleCollapse = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const copyConfig = () => {
    const text = JSON.stringify(config, null, 2)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const configSize = config ? JSON.stringify(config, null, 2).length : 0

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">📄 配置</h2>
        <div className="flex items-center gap-3">
          {config && (
            <>
              <span className="text-xs text-gray-400">
                {(configSize / 1024).toFixed(1)} KB
              </span>
              <button onClick={fetchConfig} className="text-xs text-gray-400 hover:text-white transition-colors">
                刷新 🔄
              </button>
              <button
                onClick={copyConfig}
                className="bg-[var(--accent)] text-white px-3 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-80"
              >
                {copied ? '已复制 ✓' : '复制'}
              </button>
            </>
          )}
        </div>
      </div>

      {loading && (
        <div className="bg-[var(--surface)] rounded-xl p-8 border border-[var(--border)] text-center text-gray-400">
          加载中...
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {config && !loading && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
          {/* 配置概览 */}
          <ConfigMeta config={config} />
          {/* JSON 查看器 */}
          <div className="p-4 overflow-auto max-h-[70vh]">
            <pre className="text-sm leading-relaxed font-mono whitespace-pre">
              <JsonNode
                value={config}
                path="$"
                depth={0}
                collapsed={collapsed}
                onToggle={toggleCollapse}
              />
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/** 显示配置顶层摘要 */
function ConfigMeta({ config }: { config: any }) {
  const inbounds = config?.inbounds?.length || 0
  const outbounds = config?.outbounds?.length || 0
  const rules = config?.route?.rules?.length || 0
  const hasDNS = !!config?.dns
  const hasExperimental = !!config?.experimental

  const items = [
    { label: '入站', value: `${inbounds} 条` },
    { label: '出站', value: `${outbounds} 条` },
    { label: '路由规则', value: `${rules} 条` },
    { label: 'DNS', value: hasDNS ? '已配置' : '未配置' },
    { label: '实验性', value: hasExperimental ? '已配置' : '未配置' },
  ]

  return (
    <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-[var(--border)] bg-[#0f1419]/50">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-500">{item.label}</span>
          <span className="text-gray-200 font-medium">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  JSON 语法高亮递归渲染
// ═══════════════════════════════════════════════════════════

const COLORS: Record<string, string> = {
  key: '#7dcfff',
  string: '#a5d6a7',
  number: '#ffcc80',
  boolean: '#ce93d8',
  null: '#ef9a9a',
  bracket: '#888',
  punctuation: '#666',
}

/** 可折叠的数组/对象容器 — 先定义以支持 JsonNode 中的引用 */
function JsonCollection({
  value,
  path,
  depth,
  collapsed: collapsedSet,
  onToggle,
  bracketOpen,
  bracketClose,
  isEmpty,
  children,
}: {
  value: any
  path: string
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  bracketOpen: string
  bracketClose: string
  isEmpty: boolean
  children: React.ReactNode
}) {
  const isCollapsed = collapsedSet.has(path)
  const count = Array.isArray(value) ? value.length : Object.keys(value).length
  const summary = Array.isArray(value) ? `${count} 项` : `${count} 个字段`

  if (isEmpty) {
    return (
      <span>
        <span style={{ color: COLORS.bracket }}>{bracketOpen}{bracketClose}</span>
      </span>
    )
  }

  return (
    <span>
      <span
        onClick={() => onToggle(path)}
        className="cursor-pointer select-none hover:opacity-70"
        style={{ color: COLORS.bracket }}
      >
        {bracketOpen}
      </span>
      {isCollapsed ? (
        <span
          onClick={() => onToggle(path)}
          className="cursor-pointer select-none"
        >
          <span style={{ color: COLORS.punctuation }}> … </span>
          <span className="text-xs text-gray-500">{summary}</span>
          <span style={{ color: COLORS.punctuation }}> </span>
        </span>
      ) : (
        <span>
          {'\n'}
          {children}
          {'\n'}
          {'  '.repeat(depth)}
        </span>
      )}
      <span style={{ color: COLORS.bracket }}>{bracketClose}</span>
    </span>
  )
}

/** 递归 JSON 节点渲染 */
function JsonNode({
  value,
  path,
  depth,
  collapsed,
  onToggle,
}: {
  value: any
  path: string
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
}) {
  // null
  if (value === null) {
    return <span style={{ color: COLORS.null }}>null</span>
  }

  // boolean
  if (typeof value === 'boolean') {
    return <span style={{ color: COLORS.boolean }}>{value.toString()}</span>
  }

  // number
  if (typeof value === 'number') {
    return <span style={{ color: COLORS.number }}>{value}</span>
  }

  // string — 长字符串截断
  if (typeof value === 'string') {
    const display = value.length > 120 ? value.slice(0, 120) + '…' : value
    return (
      <span style={{ color: COLORS.string }} title={value.length > 120 ? value : undefined}>
        &quot;{display}&quot;
      </span>
    )
  }

  const nextIndent = '  '.repeat(depth + 1)

  // array
  if (Array.isArray(value)) {
    return (
      <JsonCollection
        value={value}
        path={path}
        depth={depth}
        collapsed={collapsed}
        onToggle={onToggle}
        bracketOpen="["
        bracketClose="]"
        isEmpty={value.length === 0}
      >
        {value.map((item, i) => (
          <span key={i}>
            {nextIndent}
            <JsonNode
              value={item}
              path={`${path}[${i}]`}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
            {i < value.length - 1 && <span style={{ color: COLORS.punctuation }}>,</span>}
            {'\n'}
          </span>
        ))}
      </JsonCollection>
    )
  }

  // object
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    return (
      <JsonCollection
        value={value}
        path={path}
        depth={depth}
        collapsed={collapsed}
        onToggle={onToggle}
        bracketOpen="{"
        bracketClose="}"
        isEmpty={entries.length === 0}
      >
        {entries.map(([key, val], i) => (
          <span key={key}>
            {nextIndent}
            <span style={{ color: COLORS.key }}>&quot;{key}&quot;</span>
            <span style={{ color: COLORS.punctuation }}>: </span>
            <JsonNode
              value={val}
              path={`${path}.${key}`}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
            {i < entries.length - 1 && <span style={{ color: COLORS.punctuation }}>,</span>}
            {'\n'}
          </span>
        ))}
      </JsonCollection>
    )
  }

  return <span>{String(value)}</span>
}
