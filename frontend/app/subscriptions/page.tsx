'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/components/Sidebar'

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<any[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeSub, setActiveSub] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cachedData, setCachedData] = useState<Record<string, any>>({})
  const [showRaw, setShowRaw] = useState(false)

  const loadSubs = useCallback(async () => {
    const r = await api('/api/subscriptions')
    if (r.ok) setSubs(r.data.subscriptions || [])
  }, [])

  useEffect(() => { loadSubs() }, [loadSubs])

  const addSub = async () => {
    if (!name || !url) return
    setLoading(true)
    // 一次请求：拉取→验证→保存→返回订阅+解析结果
    const r = await api('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    })
    if (r.ok) {
      const sub = r.data.subscription
      const result = r.data.result
      setName(''); setUrl('')
      setCachedData(prev => ({ ...prev, [sub.id]: result }))
      setExpandedId(sub.id)
      await loadSubs()
    } else {
      alert(r.error || '添加失败')
    }
    setLoading(false)
  }

  const deleteSub = async (id: string) => {
    await api(`/api/subscriptions/${id}`, { method: 'DELETE' })
    setCachedData(prev => { const n = { ...prev }; delete n[id]; return n })
    setActiveSub(null)
    loadSubs()
  }

  const fetchSub = async (id: string) => {
    setLoading(true)
    const r = await api(`/api/subscriptions/${id}/fetch`, { method: 'POST' })
    if (r.ok) {
      setCachedData(prev => ({ ...prev, [id]: r.data }))
      setExpandedId(id)
    }
    await loadSubs()
    setLoading(false)
  }

  const applySub = async (id: string) => {
    setLoading(true)
    const r = await api(`/api/subscriptions/${id}/apply`, { method: 'POST' })
    if (r.ok) setActiveSub(id)
    setLoading(false)
  }

  const toggleDetail = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    if (!cachedData[id]) {
      const r = await api(`/api/subscriptions/${id}/data`)
      if (r.ok) setCachedData(prev => ({ ...prev, [id]: r.data }))
    }
    setExpandedId(id)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">📡 订阅管理</h2>

      <div className="bg-[var(--surface)] rounded-xl p-4 mb-6 border border-[var(--border)]">
        <h3 className="font-semibold mb-3">添加订阅</h3>
        <div className="flex gap-3 mb-3">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="名称"
            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="Clash 订阅地址"
            className="flex-[2] bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={addSub} disabled={loading}
          className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
          {loading ? '验证中...' : '添加订阅'}
        </button>
      </div>

      {subs.map(sub => (
        <div key={sub.id} className="bg-[var(--surface)] rounded-xl p-4 mb-3 border border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="font-semibold">{sub.name}
                {activeSub === sub.id && <span className="ml-2 text-xs text-green-400">● 当前</span>}
              </span>
              {sub.node_count > 0 && (
                <span className="ml-2 text-xs text-gray-400">({sub.node_count} 节点)</span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => fetchSub(sub.id)}
                className="bg-[var(--accent)] text-white px-3 py-1 rounded text-xs hover:opacity-90">更新</button>
              <button onClick={() => applySub(sub.id)} disabled={sub.node_count === 0}
                className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:opacity-90 disabled:opacity-50">应用</button>
              <button onClick={() => toggleDetail(sub.id)}
                className="bg-gray-500/20 text-gray-300 px-3 py-1 rounded text-xs hover:bg-gray-500/30">
                {expandedId === sub.id ? '收起' : '详情'}
              </button>
              <button onClick={() => deleteSub(sub.id)}
                className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30">删除</button>
            </div>
          </div>
          <div className="text-xs text-gray-500 truncate">{sub.url}</div>

          {expandedId === sub.id && cachedData[sub.id] && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  {cachedData[sub.id].node_count} 个节点
                </span>
                <button onClick={() => setShowRaw(!showRaw)}
                  className="text-xs text-[var(--accent)] hover:underline">
                  {showRaw ? '结构化' : '原始数据'}
                </button>
              </div>
              {showRaw ? (
                <div className="bg-[#0f1419] rounded-lg p-3 font-mono text-xs max-h-64 overflow-auto whitespace-pre-wrap">
                  {(cachedData[sub.id].raw_lines || []).join('\n')}
                </div>
              ) : (
                <div className="max-h-64 overflow-auto">
                  {(cachedData[sub.id].nodes || []).map((n: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-[var(--border)]/30 last:border-0">
                      <span className="text-gray-600 w-5">{i + 1}</span>
                      <span className="w-16 text-gray-500 truncate">{n.region}</span>
                      <span className="flex-1 truncate">{n.tag}</span>
                      <span className="text-gray-500">{n.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
