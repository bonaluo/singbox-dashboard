'use client'

import { useSSE } from '@/hooks/useSSE'
import { useState, useRef, useEffect, useCallback } from 'react'

interface Connection {
  id: string
  metadata: {
    network: string
    type: string
    sourceIP: string
    sourcePort: string
    destinationIP: string
    destinationPort: string
    host: string
    dnsMode: string
    processPath: string
    source_ip?: string
    source_port?: string
    destination_ip?: string
    destination_port?: string
  }
  upload: number
  download: number
  start: string
  chains: string[]
  rule: string
  rulePayload: string
  rule_payload?: string
}

function fmtBytes(n: number) {
  if (!n || n < 1024) return `${n || 0} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDuration(start: string) {
  if (!start) return '-'
  const ms = Date.now() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

// 默认列宽 (px)
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  host: 240,
  network: 80,
  source: 140,
  chain: 200,
  rule: 180,
  upload: 80,
  download: 80,
  duration: 90,
}
const MIN_COL_WIDTH = 50

export default function ConnectionsPage() {
  const { connections: sseData } = useSSE(['connections'])
  const conns: Connection[] = sseData?.connections || []
  const [sortKey, setSortKey] = useState<string>('start')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  // ── 列宽拖拽调整 ──
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS)
  const resizeRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null)
  const [resizing, setResizing] = useState<string | null>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { col, startX: e.clientX, startWidth: colWidths[col] }
    setResizing(col)
  }, [colWidths])

  useEffect(() => {
    if (!resizing) return
    // 拖拽时禁止选中文字，避免影响体验
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = e.clientX - resizeRef.current.startX
      const newWidth = Math.max(MIN_COL_WIDTH, resizeRef.current.startWidth + delta)
      setColWidths(prev => ({ ...prev, [resizing]: newWidth }))
    }
    const handleMouseUp = () => {
      resizeRef.current = null
      setResizing(null)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizing])

  // ── 排序 ──

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 1 ? -1 : 1))
    } else {
      setSortKey(key)
      setSortDir(-1)
    }
  }

  const sorted = [...conns].sort((a, b) => {
    let va: any, vb: any
    switch (sortKey) {
      case 'host':
        va = a.metadata?.host || ''
        vb = b.metadata?.host || ''
        break
      case 'network':
        va = a.metadata?.network || ''
        vb = b.metadata?.network || ''
        break
      case 'upload':
        va = a.upload || 0
        vb = b.upload || 0
        break
      case 'download':
        va = a.download || 0
        vb = b.download || 0
        break
      case 'rule':
        va = a.rule || ''
        vb = b.rule || ''
        break
      case 'chain':
        va = [...(a.chains || [])].reverse().join('→')
        vb = [...(b.chains || [])].reverse().join('→')
        break
      case 'duration':
        va = a.start ? new Date(a.start).getTime() : 0
        vb = b.start ? new Date(b.start).getTime() : 0
        break
      default:
        va = a.start || ''
        vb = b.start || ''
    }
    if (va < vb) return -1 * sortDir
    if (va > vb) return 1 * sortDir
    return 0
  })

  const totalUpload = conns.reduce((s, c) => s + (c.upload || 0), 0)
  const totalDownload = conns.reduce((s, c) => s + (c.download || 0), 0)

  // ── 子组件 ──

  const SortArrow = ({ col }: { col: string }) => {
    if (sortKey !== col) return <span className="text-gray-600 ml-1">⇅</span>
    return <span className="text-[var(--accent)] ml-1">{sortDir === 1 ? '↑' : '↓'}</span>
  }

  // 可拖拽调整宽度的表头
  const ResizeHandle = ({ col }: { col: string }) => (
    <div
      className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize transition-colors z-10 ${
        resizing === col ? 'bg-[var(--accent)]/40' : 'hover:bg-[var(--accent)]/20'
      }`}
      onMouseDown={(e) => handleResizeStart(e, col)}
      title="拖拽调整列宽"
    />
  )

  const Th = ({ col, label }: { col: string; label: string }) => (
    <th
      onClick={() => toggleSort(col)}
      className="text-left text-xs text-gray-400 py-2 px-3 cursor-pointer select-none hover:text-gray-200 transition-colors whitespace-nowrap relative"
      style={{ width: colWidths[col] }}
    >
      {label}
      <SortArrow col={col} />
      <ResizeHandle col={col} />
    </th>
  )

  // ── 渲染 ──

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">🔌 活动连接</h2>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>↑ {fmtBytes(totalUpload)}</span>
          <span>↓ {fmtBytes(totalDownload)}</span>
          <span className="text-gray-600">|</span>
          <span>{conns.length} 个连接</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500">实时推送</span>
        </div>
      </div>

      {conns.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl p-12 border border-[var(--border)] text-center text-gray-500 text-sm">
          暂无活动连接
        </div>
      )}

      {conns.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed" style={{ minWidth: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
              <colgroup>
                {Object.entries(colWidths).map(([key, w]) => (
                  <col key={key} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0f1419]/50">
                  <Th col="host" label="目标" />
                  <Th col="network" label="协议" />
                  <th
                    className="text-left text-xs text-gray-400 py-2 px-3 whitespace-nowrap relative"
                    style={{ width: colWidths.source }}
                  >
                    源
                    <ResizeHandle col="source" />
                  </th>
                  <Th col="chain" label="链路" />
                  <Th col="rule" label="匹配规则" />
                  <Th col="upload" label="上传" />
                  <Th col="download" label="下载" />
                  <Th col="duration" label="持续时间" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const meta: any = c.metadata || {}
                  const host = meta.host || '-'
                  const network = meta.network || meta.type || '-'
                  const srcIP = meta.sourceIP || meta.source_ip || ''
                  const srcPort = meta.sourcePort || meta.source_port || ''
                  const src = srcIP ? `${srcIP}:${srcPort}` : '-'
                  const dstIP = meta.destinationIP || meta.destination_ip || ''
                  const dstPort = meta.destinationPort || meta.destination_port || ''
                  const dst = dstIP ? `${dstIP}:${dstPort}` : ''
                  // sing-box API 返回的 chains 是叶子节点在前（如 ["HK香港-01", "proxy"]），
                  // 反转后显示为 "proxy → HK香港-01" 更符合路由流向的直觉
                  const chains = [...(c.chains || [])].reverse().join(' → ') || '-'
                  const rule = c.rulePayload || c.rule_payload || c.rule || '-'

                  return (
                    <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface-hover)]/50 transition-colors">
                      {/* 目标 */}
                      <td className="py-2 px-3">
                        <div
                          className="text-gray-200 truncate"
                          style={{ maxWidth: colWidths.host - 24 }}
                          title={host}
                        >
                          {host}
                        </div>
                        {dst && (
                          <div
                            className="text-xs text-gray-500 truncate"
                            style={{ maxWidth: colWidths.host - 24 }}
                            title={dst}
                          >
                            {dst}
                          </div>
                        )}
                      </td>
                      {/* 协议 */}
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
                          network === 'tcp' ? 'bg-blue-500/20 text-blue-400' :
                          network === 'udp' ? 'bg-green-500/20 text-green-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {network.toUpperCase()}
                        </span>
                      </td>
                      {/* 源 */}
                      <td className="py-2 px-3">
                        <div
                          className="text-xs text-gray-400 font-mono truncate"
                          style={{ maxWidth: colWidths.source - 24 }}
                          title={src}
                        >
                          {src}
                        </div>
                      </td>
                      {/* 链路 */}
                      <td className="py-2 px-3">
                        <div
                          className="text-xs text-gray-400 truncate"
                          style={{ maxWidth: colWidths.chain - 24 }}
                          title={`链路: ${chains}`}
                        >
                          {chains}
                        </div>
                      </td>
                      {/* 匹配规则 */}
                      <td className="py-2 px-3">
                        <div
                          className="text-xs text-yellow-400 truncate"
                          style={{ maxWidth: colWidths.rule - 24 }}
                          title={rule}
                        >
                          {rule}
                        </div>
                      </td>
                      {/* 上传 */}
                      <td className="py-2 px-3 text-xs text-orange-400 font-mono whitespace-nowrap">
                        {fmtBytes(c.upload)}
                      </td>
                      {/* 下载 */}
                      <td className="py-2 px-3 text-xs text-cyan-400 font-mono whitespace-nowrap">
                        {fmtBytes(c.download)}
                      </td>
                      {/* 持续时间 */}
                      <td className="py-2 px-3 text-xs text-gray-400 font-mono whitespace-nowrap">
                        {fmtDuration(c.start)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
