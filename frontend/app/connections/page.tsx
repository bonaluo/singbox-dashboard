'use client'

import { useSSE } from '@/hooks/useSSE'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

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

function fmtSpeed(bytesPerSec: number) {
  if (!bytesPerSec || bytesPerSec < 0) return '0 B/s'
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
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
  upload_speed: 90,
  download_speed: 90,
  duration: 90,
}
const MIN_COL_WIDTH = 50

// 可搜索的列定义
const SEARCH_COLUMNS: { key: string; label: string }[] = [
  { key: 'all', label: '所有列' },
  { key: 'host', label: '目标' },
  { key: 'network', label: '协议' },
  { key: 'source', label: '源' },
  { key: 'chain', label: '链路' },
  { key: 'rule', label: '匹配规则' },
]

export default function ConnectionsPage() {
  const { connections: sseData } = useSSE(['connections'])
  const conns: Connection[] = sseData?.connections || []
  const [sortKey, setSortKey] = useState<string>('start')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  // ── 搜索状态 ──
  const [searchText, setSearchText] = useState('')
  const [searchColumn, setSearchColumn] = useState<string>('all')

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

  // ── 速度计算 ──
  // 根据两次 SSE 推送之间的数据差计算实时速率（bytes/s）
  const prevSnapshotRef = useRef<{
    data: Map<string, { upload: number; download: number }>
    timestamp: number
  }>({ data: new Map(), timestamp: Date.now() })

  const speeds = useMemo(() => {
    const now = Date.now()
    const elapsed = (now - prevSnapshotRef.current.timestamp) / 1000
    const prev = prevSnapshotRef.current.data

    const result = new Map<string, { uploadSpeed: number; downloadSpeed: number }>()

    for (const c of conns) {
      const prevData = prev.get(c.id)
      if (prevData && elapsed > 0 && elapsed < 30) {
        result.set(c.id, {
          uploadSpeed: Math.max(0, (c.upload - prevData.upload) / elapsed),
          downloadSpeed: Math.max(0, (c.download - prevData.download) / elapsed),
        })
      } else {
        // 新连接或间隔过长，显示当前速率（下次有历史数据后会更新）
        result.set(c.id, { uploadSpeed: 0, downloadSpeed: 0 })
      }
    }

    // 更新 ref 供下次计算
    const newData = new Map<string, { upload: number; download: number }>()
    for (const c of conns) {
      newData.set(c.id, { upload: c.upload, download: c.download })
    }
    prevSnapshotRef.current = { data: newData, timestamp: now }

    return result
  }, [conns])

  // ── 获取某行某列的搜索文本 ──
  const getCellSearchText = useCallback((c: Connection, col: string): string => {
    const meta: any = c.metadata || {}
    switch (col) {
      case 'host':
        const host = meta.host || ''
        const dstIP = meta.destinationIP || meta.destination_ip || ''
        const dstPort = meta.destinationPort || meta.destination_port || ''
        const dst = dstIP ? `${dstIP}:${dstPort}` : ''
        return `${host} ${dst}`
      case 'network':
        return meta.network || meta.type || ''
      case 'source':
        const srcIP = meta.sourceIP || meta.source_ip || ''
        const srcPort = meta.sourcePort || meta.source_port || ''
        return srcIP ? `${srcIP}:${srcPort}` : ''
      case 'chain':
        return [...(c.chains || [])].reverse().join(' → ') || ''
      case 'rule':
        return c.rulePayload || c.rule_payload || c.rule || ''
      default:
        return ''
    }
  }, [])

  // ── 所有列的搜索文本（用于 "所有列" 搜索）──
  const getAllSearchText = useCallback((c: Connection): string => {
    const parts: string[] = []
    for (const sc of SEARCH_COLUMNS) {
      if (sc.key === 'all') continue
      parts.push(getCellSearchText(c, sc.key))
    }
    // 加入上传/下载/速度/持续时间
    const s = speeds.get(c.id)
    parts.push(fmtBytes(c.upload))
    parts.push(fmtBytes(c.download))
    if (s) {
      parts.push(fmtSpeed(s.uploadSpeed))
      parts.push(fmtSpeed(s.downloadSpeed))
    }
    parts.push(fmtDuration(c.start))
    return parts.join(' ')
  }, [getCellSearchText, speeds])

  // ── 过滤 ──
  const filtered = useMemo(() => {
    if (!searchText.trim()) return conns

    const query = searchText.toLowerCase().trim()
    return conns.filter(c => {
      if (searchColumn === 'all') {
        return getAllSearchText(c).toLowerCase().includes(query)
      }
      return getCellSearchText(c, searchColumn).toLowerCase().includes(query)
    })
  }, [conns, searchText, searchColumn, getCellSearchText, getAllSearchText])

  // ── 排序 ──

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 1 ? -1 : 1))
    } else {
      setSortKey(key)
      setSortDir(-1)
    }
  }

  const sorted = [...filtered].sort((a, b) => {
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
      case 'upload_speed': {
        const sa = speeds.get(a.id)
        const sb = speeds.get(b.id)
        va = sa ? sa.uploadSpeed : 0
        vb = sb ? sb.uploadSpeed : 0
        break
      }
      case 'download_speed': {
        const sa = speeds.get(a.id)
        const sb = speeds.get(b.id)
        va = sa ? sa.downloadSpeed : 0
        vb = sb ? sb.downloadSpeed : 0
        break
      }
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
      className="text-left text-xs text-gray-400 py-2 px-3 cursor-pointer select-none hover:text-gray-200 transition-colors whitespace-nowrap relative border-r border-[var(--border)]"
      style={{ width: colWidths[col] }}
    >
      {label}
      <SortArrow col={col} />
      <ResizeHandle col={col} />
    </th>
  )

  // ── 列键列表（按表头顺序）──
  const colKeys = ['host', 'network', 'source', 'chain', 'rule', 'upload', 'download', 'upload_speed', 'download_speed', 'duration']

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

      {/* ── 搜索栏 ── */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索连接..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--accent)]/60 transition-colors"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={searchColumn}
          onChange={(e) => setSearchColumn(e.target.value)}
          className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-gray-300 px-2 py-1.5 focus:outline-none focus:border-[var(--accent)]/60 transition-colors"
        >
          {SEARCH_COLUMNS.map(sc => (
            <option key={sc.key} value={sc.key}>{sc.label}</option>
          ))}
        </select>
        {searchText && (
          <span className="text-xs text-gray-500">
            {filtered.length} / {conns.length} 条
          </span>
        )}
      </div>

      {filtered.length === 0 && conns.length > 0 && searchText && (
        <div className="bg-[var(--surface)] rounded-xl p-12 border border-[var(--border)] text-center text-gray-500 text-sm">
          没有匹配 "{searchText}" 的连接
        </div>
      )}

      {conns.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl p-12 border border-[var(--border)] text-center text-gray-500 text-sm">
          暂无活动连接
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed" style={{ minWidth: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
              <colgroup>
                {colKeys.map((key) => (
                  <col key={key} style={{ width: colWidths[key] }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0f1419]/50">
                  <Th col="host" label="目标" />
                  <Th col="network" label="协议" />
                  <th
                    className="text-left text-xs text-gray-400 py-2 px-3 whitespace-nowrap relative border-r border-[var(--border)]"
                    style={{ width: colWidths.source }}
                  >
                    源
                    <ResizeHandle col="source" />
                  </th>
                  <Th col="chain" label="链路" />
                  <Th col="rule" label="匹配规则" />
                  <Th col="upload" label="上传" />
                  <Th col="download" label="下载" />
                  <Th col="upload_speed" label="上传速度" />
                  <Th col="download_speed" label="下载速度" />
                  {/* 最后一列不加右边框 */}
                  <th
                    onClick={() => toggleSort('duration')}
                    className="text-left text-xs text-gray-400 py-2 px-3 cursor-pointer select-none hover:text-gray-200 transition-colors whitespace-nowrap relative"
                    style={{ width: colWidths.duration }}
                  >
                    持续时间
                    <SortArrow col="duration" />
                    <ResizeHandle col="duration" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, rowIdx) => {
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
                  const s = speeds.get(c.id)
                  const upSpeed = s ? fmtSpeed(s.uploadSpeed) : '-'
                  const downSpeed = s ? fmtSpeed(s.downloadSpeed) : '-'

                  const isLastRow = rowIdx === sorted.length - 1

                  return (
                    <tr key={c.id} className={`${isLastRow ? '' : 'border-b border-[var(--border)]/50'} hover:bg-[var(--surface-hover)]/50 transition-colors`}>
                      {/* 目标 */}
                      <td className="py-2 px-3 border-r border-[var(--border)]/50">
                        <div className="text-gray-200 truncate" title={host}>
                          {host}
                        </div>
                        {dst && (
                          <div className="text-xs text-gray-500 truncate" title={dst}>
                            {dst}
                          </div>
                        )}
                      </td>
                      {/* 协议 */}
                      <td className="py-2 px-3 border-r border-[var(--border)]/50">
                        <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
                          network === 'tcp' ? 'bg-blue-500/20 text-blue-400' :
                          network === 'udp' ? 'bg-green-500/20 text-green-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {network.toUpperCase()}
                        </span>
                      </td>
                      {/* 源 */}
                      <td className="py-2 px-3 border-r border-[var(--border)]/50">
                        <div className="text-xs text-gray-400 font-mono truncate" title={src}>
                          {src}
                        </div>
                      </td>
                      {/* 链路 */}
                      <td className="py-2 px-3 border-r border-[var(--border)]/50">
                        <div className="text-xs text-gray-400 truncate" title={`链路: ${chains}`}>
                          {chains}
                        </div>
                      </td>
                      {/* 匹配规则 */}
                      <td className="py-2 px-3 border-r border-[var(--border)]/50">
                        <div className="text-xs text-yellow-400 truncate" title={rule}>
                          {rule}
                        </div>
                      </td>
                      {/* 上传 */}
                      <td className="py-2 px-3 text-xs text-orange-400 font-mono whitespace-nowrap border-r border-[var(--border)]/50">
                        {fmtBytes(c.upload)}
                      </td>
                      {/* 下载 */}
                      <td className="py-2 px-3 text-xs text-cyan-400 font-mono whitespace-nowrap border-r border-[var(--border)]/50">
                        {fmtBytes(c.download)}
                      </td>
                      {/* 上传速度 */}
                      <td className="py-2 px-3 text-xs text-orange-400/70 font-mono whitespace-nowrap border-r border-[var(--border)]/50">
                        {upSpeed}
                      </td>
                      {/* 下载速度 */}
                      <td className="py-2 px-3 text-xs text-cyan-400/70 font-mono whitespace-nowrap border-r border-[var(--border)]/50">
                        {downSpeed}
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
