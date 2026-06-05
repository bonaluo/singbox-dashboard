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

  // 聚合相关
  const [showMerge, setShowMerge] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [mergeSources, setMergeSources] = useState<Set<string>>(new Set())
  const [mergeExtraUrl, setMergeExtraUrl] = useState('')

  const loadSubs = useCallback(async () => {
    const r = await api('/api/subscriptions')
    if (r.ok) {
      setSubs(r.data.subscriptions || [])
      if (r.data.applied_id) setActiveSub(r.data.applied_id)
    }
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

  const toggleSource = (id: string) => {
    setMergeSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const createMerge = async () => {
    if (!mergeName) return
    if (mergeSources.size === 0 && !mergeExtraUrl) return
    setLoading(true)
    // 多个链接用换行分隔
    const urls = mergeExtraUrl.split('\n').map((s: string) => s.trim()).filter(Boolean)
    const r = await api('/api/subscriptions/merge', {
      method: 'POST',
      body: JSON.stringify({
        name: mergeName,
        sources: Array.from(mergeSources),
        extra_urls: urls.length > 0 ? urls : undefined,
      }),
    })
    if (r.ok) {
      const sub = r.data.subscription
      setMergeName('')
      setMergeSources(new Set())
      setMergeExtraUrl('')
      setShowMerge(false)
      await loadSubs()
    } else {
      alert(r.error || '聚合失败')
    }
    setLoading(false)
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
        <div className="flex gap-2">
          <button onClick={addSub} disabled={loading}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? '验证中...' : '添加订阅'}
          </button>
          <button onClick={() => setShowMerge(!showMerge)}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
            {showMerge ? '取消聚合' : '📎 创建聚合订阅'}
          </button>
        </div>
      </div>

      {/* 聚合表单 */}
      {showMerge && (
        <div className="bg-[var(--surface)] rounded-xl p-4 mb-6 border border-purple-500/30">
          <h3 className="font-semibold mb-3 text-purple-400">📎 创建聚合订阅</h3>

          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">聚合名称</label>
            <input value={mergeName} onChange={e => setMergeName(e.target.value)}
              placeholder="例如: 全部节点聚合"
              className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          </div>

          {subs.length > 0 && (
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 block">
                选择已有订阅（已选 {mergeSources.size} 个）
              </label>
              <div className="max-h-40 overflow-y-auto space-y-1 border border-[var(--border)] rounded-lg p-2">
                {subs.map(s => (
                  <button
                    key={s.id}
                    onClick={() => toggleSource(s.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                      mergeSources.has(s.id)
                        ? 'bg-purple-500/10 border-l-2 border-purple-500'
                        : 'hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                      mergeSources.has(s.id)
                        ? 'bg-purple-500 border-purple-500 text-white'
                        : 'border-gray-500'
                    }`}>
                      {mergeSources.has(s.id) ? '✓' : ''}
                    </span>
                    <span className="truncate">{s.name}</span>
                    {s.node_count > 0 && (
                      <span className="text-xs text-gray-500 shrink-0">({s.node_count})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">额外订阅链接（可选，每行一个）</label>
            <textarea value={mergeExtraUrl} onChange={e => setMergeExtraUrl(e.target.value)}
              placeholder="https://sub1.example.com&#10;https://sub2.example.com"
              rows={3}
              className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          </div>

          <button onClick={createMerge} disabled={loading || !mergeName || (mergeSources.size === 0 && !mergeExtraUrl)}
            className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? '合并中...' : `创建聚合 (${mergeSources.size} 订阅${mergeExtraUrl ? ' + 额外链接' : ''})`}
          </button>
        </div>
      )}

      {subs.map(sub => (
        <div key={sub.id} className="bg-[var(--surface)] rounded-xl p-4 mb-3 border border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {sub.kind === 'aggregated' && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">
                  聚合
                </span>
              )}
              {sub.kind === 'ad_hoc' && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-mono">
                  临时
                </span>
              )}
              <span className="font-semibold">{sub.name}
                {activeSub === sub.id && <span className="ml-2 text-xs text-green-400">● 当前</span>}
              </span>
              {sub.node_count > 0 && (
                <span className="text-xs text-gray-400">({sub.node_count} 节点)</span>
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

          {/* 聚合订阅的子源显示 */}
          {sub.kind === 'aggregated' && sub.sources && sub.sources.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {sub.sources.map((src: any, i: number) => (
                <span
                  key={i}
                  className={`text-[10px] px-1 py-0.5 rounded ${
                    src.status === 'error'
                      ? 'bg-red-500/20 text-red-400'
                      : src.status === 'ok'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-gray-500/20 text-gray-400'
                  }`}
                  title={src.error || ''}
                >
                  {src.name || src.id?.slice(0, 10) || src.url?.slice(0, 30)}
                  {src.node_count > 0 && ` (${src.node_count})`}
                  {src.status === 'error' && ' ⚠'}
                </span>
              ))}
            </div>
          )}

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
