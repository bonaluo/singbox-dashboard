'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@/components/Sidebar'

interface OutboundOption {
  tag: string
  type: string
  now?: string
  delay?: number
}

interface NodeTestResult {
  tag: string
  latency: number        // ms, -1 = timeout/fail
  downloadSpeed: number  // MB/s, -1 = timeout/fail
  latencyStatus: 'pending' | 'testing' | 'done'
  downloadStatus: 'pending' | 'testing' | 'done'
}

interface SSEEvent {
  type: string           // "progress" | "complete" | "error"
  test_type?: string     // "latency" | "download"
  node_tag?: string
  status?: string        // "pending" | "testing" | "done"
  delay?: number
  speed?: number
  total?: number
  completed?: number
  error?: string
}

export default function NodeTestModal({
  nodes,
  onSelect,
  onClose,
  onAdd,
  onAddAndApply,
}: {
  nodes: OutboundOption[]
  onSelect: (tag: string) => void
  onClose: () => void
  onAdd: (outbound: string) => void
  onAddAndApply: (outbound: string) => void
}) {
  const [testLatency, setTestLatency] = useState(true)
  const [testDownload, setTestDownload] = useState(false)
  const [concurrency, setConcurrency] = useState(5)
  const [testing, setTesting] = useState(false)
  const [testDone, setTestDone] = useState(false)
  const [results, setResults] = useState<Map<string, NodeTestResult>>(new Map())
  const [latencyProgress, setLatencyProgress] = useState({ completed: 0, total: 0 })
  const [downloadProgress, setDownloadProgress] = useState({ completed: 0, total: 0 })
  const [sortKey, setSortKey] = useState<'latency' | 'download'>('latency')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedLatency, setExpandedLatency] = useState(false)
  const [expandedDownload, setExpandedDownload] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Reset results when test config changes
  const resetResults = useCallback(() => {
    const map = new Map<string, NodeTestResult>()
    nodes.forEach(n => {
      map.set(n.tag, {
        tag: n.tag,
        latency: -1,
        downloadSpeed: -1,
        latencyStatus: 'pending',
        downloadStatus: 'pending',
      })
    })
    setResults(map)
    setTestDone(false)
    setSelectedTag(null)
    setError('')
  }, [nodes])

  useEffect(() => { resetResults() }, [resetResults])

  // Start testing
  const startTest = async () => {
    if (testing) return
    setTesting(true)
    setTestDone(false)
    setError('')

    const tests: string[] = []
    if (testLatency) tests.push('latency')
    if (testDownload) tests.push('download')
    if (tests.length === 0) {
      setError('请至少选择一项测试')
      setTesting(false)
      return
    }

    const tags = nodes.map(n => n.tag)
    abortRef.current = new AbortController()

    // Reset progress
    if (testLatency) setLatencyProgress({ completed: 0, total: tags.length })
    if (testDownload) setDownloadProgress({ completed: 0, total: tags.length })

    // Update all results to pending
    setResults(prev => {
      const next = new Map(prev)
      tags.forEach(tag => {
        const r = next.get(tag) || { tag, latency: -1, downloadSpeed: -1, latencyStatus: 'pending' as const, downloadStatus: 'pending' as const }
        if (testLatency) r.latencyStatus = 'pending'
        if (testDownload) r.downloadStatus = 'pending'
        next.set(tag, r)
      })
      return next
    })

    try {
      const base = (() => {
        if (typeof window !== 'undefined') {
          const stored = localStorage.getItem('apiUrl')
          if (stored) return stored
        }
        return process.env.NEXT_PUBLIC_API || 'http://localhost:9092'
      })()

      const response = await fetch(`${base}/api/nodes/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, concurrency, tests }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt: SSEEvent = JSON.parse(line.slice(6))
              handleEvent(evt)
            } catch { /* skip parse errors */ }
          }
        }
      }

      // Flush remaining buffer content
      if (buffer.trim()) {
        const lines = buffer.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt: SSEEvent = JSON.parse(line.slice(6))
              handleEvent(evt)
            } catch { /* skip parse errors */ }
          }
        }
      }

      // Ensure testDone is set when stream ends successfully
      setTestDone(true)
      // Auto-select if only one test type
      setResults(prev => {
        if (!testLatency || !testDownload) {
          const key = testLatency ? 'latency' : 'download'
          let bestTag = ''
          let bestVal = Infinity
          if (key === 'latency') {
            prev.forEach((r) => {
              if (r.latency > 0 && r.latency < bestVal) {
                bestVal = r.latency
                bestTag = r.tag
              }
            })
          } else {
            prev.forEach((r) => {
              if (r.downloadSpeed > 0 && r.downloadSpeed > bestVal) {
                bestVal = r.downloadSpeed
                bestTag = r.tag
              }
            })
          }
          if (bestTag) setSelectedTag(bestTag)
        }
        return prev
      })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || '测试失败')
      }
      setTestDone(true) // 即使出错也视为测试结束
    } finally {
      setTesting(false)
      abortRef.current = null
    }
  }

  // Handle SSE event
  const handleEvent = (evt: SSEEvent) => {
    if (evt.type === 'complete') {
      setTestDone(true)
      // Auto-select best node if only one test type
      setResults(prev => {
        if (!testLatency || !testDownload) {
          const key = testLatency ? 'latency' : 'download'
          let bestTag = ''
          let bestVal = Infinity
          if (key === 'latency') {
            prev.forEach((r) => {
              if (r.latency > 0 && r.latency < bestVal) {
                bestVal = r.latency
                bestTag = r.tag
              }
            })
          } else {
            prev.forEach((r) => {
              if (r.downloadSpeed > 0 && r.downloadSpeed > bestVal) {
                bestVal = r.downloadSpeed
                bestTag = r.tag
              }
            })
          }
          if (bestTag) setSelectedTag(bestTag)
        }
        return prev
      })
      return
    }

    if (evt.type === 'error') {
      setError(evt.error || '测试出错')
      return
    }

    // Progress event
    if (evt.test_type === 'latency') {
      if (evt.total) setLatencyProgress({ completed: evt.completed || 0, total: evt.total })
      if (evt.node_tag && evt.status) {
        setResults(prev => {
          const next = new Map(prev)
          const r = next.get(evt.node_tag!) || {
            tag: evt.node_tag!, latency: -1, downloadSpeed: -1,
            latencyStatus: 'pending' as const, downloadStatus: 'pending' as const,
          }
          r.latencyStatus = evt.status as 'pending' | 'testing' | 'done'
          if (evt.delay !== undefined) r.latency = evt.delay
          next.set(evt.node_tag!, r)
          return next
        })
      }
    }

    if (evt.test_type === 'download') {
      if (evt.total) setDownloadProgress({ completed: evt.completed || 0, total: evt.total })
      if (evt.node_tag && evt.status) {
        setResults(prev => {
          const next = new Map(prev)
          const r = next.get(evt.node_tag!) || {
            tag: evt.node_tag!, latency: -1, downloadSpeed: -1,
            latencyStatus: 'pending' as const, downloadStatus: 'pending' as const,
          }
          r.downloadStatus = evt.status as 'pending' | 'testing' | 'done'
          if (evt.speed !== undefined) r.downloadSpeed = evt.speed
          next.set(evt.node_tag!, r)
          return next
        })
      }
    }
  }

  // Cancel test
  const cancelTest = () => {
    abortRef.current?.abort()
    setTesting(false)
  }

  // Get sorted results list
  const sortedResults = () => {
    const arr = Array.from(results.values()).filter(r => {
      if (testLatency && !testDownload) return r.latencyStatus === 'done'
      if (!testLatency && testDownload) return r.downloadStatus === 'done'
      return r.latencyStatus === 'done' || r.downloadStatus === 'done'
    })

    arr.sort((a, b) => {
      if (sortKey === 'latency') {
        const va = a.latency > 0 ? a.latency : 99999
        const vb = b.latency > 0 ? b.latency : 99999
        return sortAsc ? va - vb : vb - va
      } else {
        const va = a.downloadSpeed > 0 ? a.downloadSpeed : -1
        const vb = b.downloadSpeed > 0 ? b.downloadSpeed : -1
        return sortAsc ? va - vb : vb - va
      }
    })
    return arr
  }

  // Group results by status for expandable view
  const groupByStatus = (testType: 'latency' | 'download') => {
    const arr = Array.from(results.values())
    const done = arr.filter(r => testType === 'latency' ? r.latencyStatus === 'done' : r.downloadStatus === 'done')
    const testing_nodes = arr.filter(r => testType === 'latency' ? r.latencyStatus === 'testing' : r.downloadStatus === 'testing')
    const pending = arr.filter(r => testType === 'latency' ? r.latencyStatus === 'pending' : r.downloadStatus === 'pending')
    return { done, testing: testing_nodes, pending }
  }

  const renderNodeTag = (tag: string) => {
    const display = tag.length > 30 ? tag.slice(0, 28) + '…' : tag
    return display
  }

  // Progress bar component
  const ProgressBar = ({ completed, total, color }: { completed: number; total: number; color: string }) => {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return (
      <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }

  // Node list for expandable section
  const NodeStatusList = ({
    groups, testType, expanded, onToggle,
  }: {
    groups: { done: NodeTestResult[]; testing: NodeTestResult[]; pending: NodeTestResult[] }
    testType: 'latency' | 'download'
    expanded: boolean
    onToggle: () => void
  }) => {
    const total = groups.done.length + groups.testing.length + groups.pending.length
    const label = testType === 'latency' ? '延迟' : '下载'

    return (
      <div className="mt-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors w-full text-left"
        >
          <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <span>
            {label}测试详情 — 已完成 {groups.done.length}
            {groups.testing.length > 0 && ` / 测试中 ${groups.testing.length}`}
            {groups.pending.length > 0 && ` / 等待中 ${groups.pending.length}`}
            {' '}共 {total}
          </span>
        </button>

        {expanded && (
          <div className="mt-2 ml-5 space-y-1 max-h-48 overflow-y-auto">
            {/* Testing nodes */}
            {groups.testing.map(r => (
              <div key={r.tag} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
                <span className="text-yellow-400 font-mono truncate flex-1">{renderNodeTag(r.tag)}</span>
                <span className="text-yellow-400/70 shrink-0">测试中…</span>
              </div>
            ))}

            {/* Done nodes */}
            {groups.done.map(r => (
              <div key={r.tag} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-green-400 font-mono truncate flex-1">{renderNodeTag(r.tag)}</span>
                <span className="text-green-400/80 font-mono shrink-0">
                  {testType === 'latency'
                    ? (r.latency > 0 ? `${r.latency}ms` : '超时')
                    : (r.downloadSpeed > 0 ? `${r.downloadSpeed.toFixed(2)} MB/s` : '超时')
                  }
                </span>
              </div>
            ))}

            {/* Pending nodes */}
            {groups.pending.map(r => (
              <div key={r.tag} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />
                <span className="text-gray-500 font-mono truncate flex-1">{renderNodeTag(r.tag)}</span>
                <span className="text-gray-600 shrink-0">等待</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Handle add
  const handleAdd = async () => {
    if (!selectedTag || adding) return
    setAdding(true)
    await onAdd(selectedTag)
    setAdding(false)
  }

  const handleAddAndApply = async () => {
    if (!selectedTag || adding) return
    setAdding(true)
    await onAddAndApply(selectedTag)
    setAdding(false)
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal panel */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] bg-[#0f1419] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h3 className="text-base font-semibold flex items-center gap-2">
            🧪 自动选择最佳节点
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Test configuration */}
          {!testing && !testDone && (
            <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)] space-y-4">
              <h4 className="text-sm font-semibold text-gray-300">测试配置</h4>

              {/* Test type checkboxes */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={testLatency}
                    onChange={e => setTestLatency(e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  <span className="text-sm">⚡ 延迟测试</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={testDownload}
                    onChange={e => setTestDownload(e.target.checked)}
                    className="w-4 h-4 accent-green-500"
                  />
                  <span className="text-sm">📥 下载速度测试</span>
                </label>
              </div>

              {/* Concurrency */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">并发数:</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={concurrency}
                  onChange={e => setConcurrency(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                  className="w-20 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-center"
                />
                <span className="text-xs text-gray-600">（同时测试的节点数，建议 5-10）</span>
              </div>

              {/* Test count */}
              <div className="text-xs text-gray-500">
                将测试 <span className="text-[var(--accent)] font-mono">{nodes.length}</span> 个节点
                {testLatency && testDownload && '（延迟+下载并行）'}
              </div>

              {/* Start button */}
              <button
                onClick={startTest}
                disabled={(!testLatency && !testDownload) || nodes.length === 0}
                className="bg-[var(--accent)] text-white px-6 py-2.5 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
              >
                🚀 开始测试
              </button>

              {error && <div className="text-sm text-red-400">{error}</div>}
            </div>
          )}

          {/* Testing progress */}
          {testing && (
            <div className="space-y-3">
              {/* Header with cancel */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-300">测试进行中…</span>
                <button
                  onClick={cancelTest}
                  className="text-red-400 hover:text-red-300 text-sm transition-colors"
                >
                  ⏹ 取消
                </button>
              </div>

              {/* Latency progress */}
              {testLatency && (
                <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">⚡ 延迟测试</span>
                    <span className="text-xs text-gray-500 font-mono">
                      {latencyProgress.completed}/{latencyProgress.total}
                    </span>
                  </div>
                  <ProgressBar
                    completed={latencyProgress.completed}
                    total={latencyProgress.total}
                    color="bg-blue-500"
                  />
                  <NodeStatusList
                    groups={groupByStatus('latency')}
                    testType="latency"
                    expanded={expandedLatency}
                    onToggle={() => setExpandedLatency(!expandedLatency)}
                  />
                </div>
              )}

              {/* Download progress */}
              {testDownload && (
                <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">📥 下载测试</span>
                    <span className="text-xs text-gray-500 font-mono">
                      {downloadProgress.completed}/{downloadProgress.total}
                    </span>
                  </div>
                  <ProgressBar
                    completed={downloadProgress.completed}
                    total={downloadProgress.total}
                    color="bg-green-500"
                  />
                  <NodeStatusList
                    groups={groupByStatus('download')}
                    testType="download"
                    expanded={expandedDownload}
                    onToggle={() => setExpandedDownload(!expandedDownload)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Results table */}
          {testDone && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
              {/* Sort controls */}
              <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--border)] bg-[#0a0f14]">
                <span className="text-sm text-gray-300">测试结果</span>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-gray-500">排序:</span>
                  {testLatency && (
                    <button
                      onClick={() => { setSortKey('latency'); setSortAsc(sortKey === 'latency' ? !sortAsc : true) }}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        sortKey === 'latency'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      延迟 {sortKey === 'latency' && (sortAsc ? '↑' : '↓')}
                    </button>
                  )}
                  {testDownload && (
                    <button
                      onClick={() => { setSortKey('download'); setSortAsc(sortKey === 'download' ? !sortAsc : false) }}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        sortKey === 'download'
                          ? 'bg-green-500/20 text-green-400'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      下载速度 {sortKey === 'download' && (sortAsc ? '↑' : '↓')}
                    </button>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0a0f14]">
                    <tr className="text-xs text-gray-500">
                      <th className="text-left px-4 py-2 font-normal w-8">#</th>
                      <th className="text-left px-2 py-2 font-normal">节点</th>
                      {testLatency && (
                        <th className="text-right px-4 py-2 font-normal w-20">延迟</th>
                      )}
                      {testDownload && (
                        <th className="text-right px-4 py-2 font-normal w-24">下载速度</th>
                      )}
                      <th className="text-center px-4 py-2 font-normal w-16">选择</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults().map((r, i) => {
                      const latencyColor = r.latency > 0
                        ? r.latency < 200 ? 'text-green-400' : r.latency < 500 ? 'text-yellow-400' : 'text-red-400'
                        : 'text-gray-600'
                      const speedColor = r.downloadSpeed > 0
                        ? r.downloadSpeed > 10 ? 'text-green-400' : r.downloadSpeed > 3 ? 'text-yellow-400' : 'text-red-400'
                        : 'text-gray-600'

                      return (
                        <tr
                          key={r.tag}
                          className={`border-t border-[var(--border)] transition-colors cursor-pointer hover:bg-[var(--accent)]/5 ${
                            selectedTag === r.tag ? 'bg-[var(--accent)]/10 ring-1 ring-inset ring-[var(--accent)]' : ''
                          }`}
                          onClick={() => setSelectedTag(r.tag)}
                        >
                          <td className="px-4 py-2 text-xs text-gray-500">{i + 1}</td>
                          <td className="px-2 py-2">
                            <span className="font-mono text-xs truncate max-w-[200px] block">
                              {renderNodeTag(r.tag)}
                            </span>
                          </td>
                          {testLatency && (
                            <td className={`px-4 py-2 text-right font-mono text-xs ${latencyColor}`}>
                              {r.latency > 0 ? `${r.latency}ms` : '超时'}
                            </td>
                          )}
                          {testDownload && (
                            <td className={`px-4 py-2 text-right font-mono text-xs ${speedColor}`}>
                              {r.downloadSpeed > 0 ? `${r.downloadSpeed.toFixed(2)} MB/s` : '超时'}
                            </td>
                          )}
                          <td className="px-4 py-2 text-center">
                            <input
                              type="radio"
                              name="nodeSelect"
                              checked={selectedTag === r.tag}
                              onChange={() => setSelectedTag(r.tag)}
                              className="w-4 h-4 accent-[var(--accent)]"
                            />
                          </td>
                        </tr>
                      )
                    })}
                    {/* Show untested nodes */}
                    {(() => {
                      const doneTags = new Set(sortedResults().map(r => r.tag))
                      const untested = nodes.filter(n => !doneTags.has(n.tag))
                      if (untested.length === 0) return null
                      return untested.map((n, i) => (
                        <tr
                          key={n.tag}
                          className="border-t border-[var(--border)] opacity-40"
                        >
                          <td className="px-4 py-2 text-xs text-gray-600">-</td>
                          <td className="px-2 py-2">
                            <span className="font-mono text-xs truncate max-w-[200px] block text-gray-600">
                              {renderNodeTag(n.tag)}
                            </span>
                          </td>
                          {testLatency && (
                            <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">未测</td>
                          )}
                          {testDownload && (
                            <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">未测</td>
                          )}
                          <td className="px-4 py-2" />
                        </tr>
                      ))
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Re-test button */}
              <div className="flex items-center gap-3 px-4 py-3 border-t border-[var(--border)] bg-[#0a0f14]">
                <button
                  onClick={() => {
                    setTestDone(false)
                    resetResults()
                  }}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  🔄 重新测试
                </button>
                {selectedTag && (
                  <span className="text-xs text-[var(--accent)] ml-auto">
                    已选择: <span className="font-mono">{renderNodeTag(selectedTag)}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {error && !testing && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-5 py-3 shrink-0 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {nodes.length} 个节点
            {testDone && selectedTag && ' — 已选择最佳节点'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!selectedTag || adding}
              className="bg-[var(--accent)] text-white px-5 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {adding ? '添加中...' : '添加'}
            </button>
            <button
              onClick={handleAddAndApply}
              disabled={!selectedTag || adding}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {adding ? '应用中...' : '添加并应用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
