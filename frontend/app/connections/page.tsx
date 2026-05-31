'use client'

import { api } from '@/components/Sidebar'
import { useState, useEffect, useCallback } from 'react'

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

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<string>('start')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const fetchConns = useCallback(async () => {
    try {
      const r = await api('/api/connections')
      if (r.ok) {
        setConns(r.data.connections || [])
        setError('')
      } else {
        setError(r.error || '获取连接失败')
      }
    } catch {
      setError('无法连接后端')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConns()
    const t = setInterval(fetchConns, 3000)
    return () => clearInterval(t)
  }, [fetchConns])

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
        va = (a.chains || []).join('→')
        vb = (b.chains || []).join('→')
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

  const SortArrow = ({ col }: { col: string }) => {
    if (sortKey !== col) return <span className="text-gray-600 ml-1">⇅</span>
    return <span className="text-[var(--accent)] ml-1">{sortDir === 1 ? '↑' : '↓'}</span>
  }

  const Th = ({ col, label }: { col: string; label: string }) => (
    <th
      onClick={() => toggleSort(col)}
      className="text-left text-xs text-gray-400 py-2 px-3 cursor-pointer select-none hover:text-gray-200 transition-colors whitespace-nowrap"
    >
      {label}
      <SortArrow col={col} />
    </th>
  )

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
          <span className="text-gray-500">每 3s 刷新</span>
          <button onClick={fetchConns} className="text-gray-400 hover:text-white transition-colors">
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 mb-4">
          {error}
        </div>
      )}

      {loading && conns.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl p-8 border border-[var(--border)] text-center text-gray-400">
          加载中...
        </div>
      )}

      {!loading && conns.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl p-12 border border-[var(--border)] text-center text-gray-500 text-sm">
          暂无活动连接
        </div>
      )}

      {conns.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[#0f1419]/50">
                  <Th col="host" label="目标" />
                  <Th col="network" label="协议" />
                  <th className="text-left text-xs text-gray-400 py-2 px-3 whitespace-nowrap">源</th>
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
                  // 兼容不同 key 格式 (camelCase 和 snake_case)
                  const host = meta.host || '-'
                  const network = meta.network || meta.type || '-'
                  const srcIP = meta.sourceIP || meta.source_ip || ''
                  const srcPort = meta.sourcePort || meta.source_port || ''
                  const src = srcIP ? `${srcIP}:${srcPort}` : '-'
                  const dstIP = meta.destinationIP || meta.destination_ip || ''
                  const dstPort = meta.destinationPort || meta.destination_port || ''
                  const dst = dstIP ? `${dstIP}:${dstPort}` : ''
                  const chains = (c.chains || []).join(' → ') || '-'
                  const rule = c.rulePayload || c.rule_payload || c.rule || '-'

                  return (
                    <tr key={c.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface-hover)]/50 transition-colors">
                      <td className="py-2 px-3">
                        <div className="text-gray-200 max-w-[240px] truncate" title={host}>{host}</div>
                        {dst && <div className="text-xs text-gray-500">{dst}</div>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          network === 'tcp' ? 'bg-blue-500/20 text-blue-400' :
                          network === 'udp' ? 'bg-green-500/20 text-green-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {network.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-400 font-mono">{src}</td>
                      <td className="py-2 px-3 text-xs text-gray-400 max-w-[200px] truncate" title={chains}>{chains}</td>
                      <td className="py-2 px-3 text-xs text-yellow-400 max-w-[180px] truncate" title={rule}>{rule}</td>
                      <td className="py-2 px-3 text-xs text-orange-400 font-mono">{fmtBytes(c.upload)}</td>
                      <td className="py-2 px-3 text-xs text-cyan-400 font-mono">{fmtBytes(c.download)}</td>
                      <td className="py-2 px-3 text-xs text-gray-400 font-mono">{fmtDuration(c.start)}</td>
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
