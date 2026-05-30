'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/components/Sidebar'

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<any[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [parsedData, setParsedData] = useState<any>(null)
  const [showRaw, setShowRaw] = useState(false)

  const loadSubs = useCallback(async () => {
    const r = await api('/api/subscriptions')
    if (r.ok) setSubs(r.data.subscriptions || [])
  }, [])

  useEffect(() => { loadSubs() }, [loadSubs])

  const addSub = async () => {
    if (!name || !url) return
    setLoading(true)
    const r = await api('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    })
    if (r.ok) {
      setName(''); setUrl('')
      loadSubs()
    }
    setLoading(false)
  }

  const deleteSub = async (id: string) => {
    await api(`/api/subscriptions/${id}`, { method: 'DELETE' })
    loadSubs()
  }

  const fetchSub = async (id: string) => {
    setLoading(true)
    const r = await api(`/api/subscriptions/${id}/fetch`, { method: 'POST' })
    if (r.ok) setParsedData(r.data)
    setLoading(false)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">📡 订阅管理</h2>

      {/* 添加订阅 */}
      <div className="bg-[var(--surface)] rounded-xl p-4 mb-6 border border-[var(--border)]">
        <h3 className="font-semibold mb-3">添加订阅</h3>
        <div className="flex gap-3 mb-3">
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="名称 (如: KTMWAN)"
            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={url} onChange={e => setUrl(e.target.value)}
            placeholder="Clash 订阅地址"
            className="flex-[2] bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button onClick={addSub} disabled={loading}
          className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
          {loading ? '添加中...' : '添加订阅'}
        </button>
      </div>

      {/* 订阅列表 */}
      <div className="space-y-3">
        {subs.map(sub => (
          <div key={sub.id} className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-semibold">{sub.name}</span>
                {sub.node_count > 0 && (
                  <span className="ml-2 text-xs text-gray-400">({sub.node_count} 个节点)</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => fetchSub(sub.id)}
                  className="bg-[var(--accent)] text-white px-3 py-1 rounded text-xs hover:opacity-90">
                  拉取解析
                </button>
                <button onClick={() => deleteSub(sub.id)}
                  className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30">
                  删除
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-500 truncate">{sub.url}</div>
            {sub.last_updated && (
              <div className="text-xs text-gray-500 mt-1">最后更新: {sub.last_updated}</div>
            )}
          </div>
        ))}
      </div>

      {/* 解析结果 */}
      {parsedData && (
        <div className="mt-6 bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <h3 className="font-semibold">
              解析结果 — {parsedData.node_count} 个节点
            </h3>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="text-xs text-[var(--accent)] hover:underline">
              {showRaw ? '查看结构化' : '查看原始数据'}
            </button>
          </div>

          {showRaw ? (
            <div className="p-4">
              <div className="bg-[#0f1419] rounded-lg p-3 font-mono text-xs max-h-96 overflow-auto whitespace-pre-wrap">
                {parsedData.raw_lines.join('\n')}
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="grid gap-2">
                {parsedData.nodes?.slice(0, 50).map((n: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-[var(--border)]/50 last:border-0">
                    <span className="text-xs text-gray-500 w-6">{i + 1}</span>
                    <span className="w-20 text-xs text-gray-400">{n.region}</span>
                    <span className="flex-1 truncate">{n.tag}</span>
                    <span className="text-xs text-gray-500">{n.type}</span>
                    <span className="text-xs text-gray-500">{n.server}:{n.port}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
