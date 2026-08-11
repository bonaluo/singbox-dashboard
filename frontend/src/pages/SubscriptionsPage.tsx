
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/components/Sidebar'

// 订阅流量格式化（来自 subscription-userinfo 头）
function fmtBytes(b: number | undefined): string {
  if (!b || b <= 0) return ''
  const gb = b / (1024 * 1024 * 1024)
  if (gb >= 1024) return (gb / 1024).toFixed(2) + ' TB'
  return gb.toFixed(2) + ' GB'
}
function fmtExpire(ms: number | undefined): string {
  if (!ms || ms <= 0) return ''
  const d = new Date(ms)
  const now = Date.now()
  const days = Math.ceil((ms - now) / 86400000)
  if (days >= 0) return d.toLocaleDateString() + ' 到期'
  return d.toLocaleDateString() + ' 已到期'
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<any[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [content, setContent] = useState('')
  const [inputMode, setInputMode] = useState<'link' | 'content'>('link')
  // 内容粘贴弹窗
  const [showContentModal, setShowContentModal] = useState(false)
  const [modalContent, setModalContent] = useState('')
  const [loading, setLoading] = useState(false)           // 添加订阅验证中
  const [updatingId, setUpdatingId] = useState<string | null>(null) // 正在更新的订阅
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null) // 删除确认弹窗
  const [activeSub, setActiveSub] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [cachedData, setCachedData] = useState<Record<string, any>>({})
  const [showRaw, setShowRaw] = useState(false)
  // 编辑内容型订阅（更新时粘贴新内容）
  const [editContentId, setEditContentId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  // 编辑订阅（弹窗：名称/UA/外部代理/使用代理）
  const [editSub, setEditSub] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editUA, setEditUA] = useState('')
  const [editProxy, setEditProxy] = useState('')
  const [editUseProxy, setEditUseProxy] = useState(false)

  const openEditSub = (sub: any) => {
    setEditSub(sub)
    setEditName(sub.name || '')
    setEditUA(sub.fetch_ua || '')
    setEditProxy(sub.external_proxy || '')
    setEditUseProxy(!!sub.use_proxy)
  }

  // 聚合相关
  const [showMerge, setShowMerge] = useState(false)
  const [subMsg, setSubMsg] = useState('')
  const [mergeName, setMergeName] = useState('')
  const [mergeSources, setMergeSources] = useState<Set<string>>(new Set())
  const [mergeExtraUrl, setMergeExtraUrl] = useState('')
  const [useProxy, setUseProxy] = useState(false)
  // 拉取设置（全局）：UA + 外部代理
  const [fetchUA, setFetchUA] = useState('')
  const [fetchProxy, setFetchProxy] = useState('')
  const [uaSaved, setUaSaved] = useState('') // '' | 'ua' | 'proxy' 最近保存成功的项
  // 订阅级拉取设置（添加订阅时）
  const [subUA, setSubUA] = useState('')
  const [subProxy, setSubProxy] = useState('')

  const loadSubs = useCallback(async () => {
    const r = await api('/api/subscriptions')
    if (r.ok) {
      setSubs(r.data.subscriptions || [])
      if (r.data.applied_id) setActiveSub(r.data.applied_id)
      if (r.data.fetch_ua) setFetchUA(r.data.fetch_ua)
      if (r.data.fetch_proxy) setFetchProxy(r.data.fetch_proxy)
    }
  }, [])

  const saveFetchSettings = async (kind: 'ua' | 'proxy') => {
    const path = kind === 'ua' ? '/api/subscriptions/ua' : '/api/subscriptions/proxy'
    const body = kind === 'ua'
      ? { ua: fetchUA.trim() }
      : { proxy: fetchProxy.trim() }
    const r = await api(path, { method: 'PUT', body: JSON.stringify(body) })
    if (r.ok) {
      setUaSaved(kind)
      setTimeout(() => setUaSaved(''), 2000)
    } else {
      setSubMsg('❌ ' + (r.error || '保存失败'))
    }
  }

  const saveEditSub = async () => {
    if (!editSub) return
    setLoading(true)
    const r = await api(`/api/subscriptions/${editSub.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: editName.trim(),
        fetch_ua: editUA.trim(),
        external_proxy: editProxy.trim(),
        use_proxy: editUseProxy,
      }),
    })
    setLoading(false)
    if (r.ok) {
      setEditSub(null)
      await loadSubs()
    } else {
      setSubMsg('❌ ' + (r.error || '保存失败'))
    }
  }

  useEffect(() => { loadSubs() }, [loadSubs])

  const addSub = async () => {
    if (!name) return
    if (inputMode === 'link' && !url) return
    if (inputMode === 'content' && !content) return
    setLoading(true)
    const payload: Record<string, any> = {
      name, use_proxy: useProxy,
      fetch_ua: subUA.trim(), external_proxy: subProxy.trim(),
    }
    if (inputMode === 'link') payload.url = url
    else payload.content = content
    const r = await api('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      const sub = r.data.subscription
      const result = r.data.result
      setName(''); setUrl(''); setContent(''); setSubUA(''); setSubProxy(''); setUseProxy(false)
      setCachedData(prev => ({ ...prev, [sub.id]: result }))
      setExpandedId(sub.id)
      await loadSubs()
    } else {
      setSubMsg('❌ ' + (r.error || '添加失败'))
    }
    setLoading(false)
  }

  const fetchSub = async (id: string) => {
    // 内容型订阅：打开内联编辑框粘贴新内容
    const sub = subs.find(s => s.id === id)
    if (sub && sub.content) {
      setEditContentId(id)
      setEditContent(sub.content)
      return
    }
    setUpdatingId(id)
    const r = await api(`/api/subscriptions/${id}/fetch`, { method: 'POST' })
    setUpdatingId(null)
    if (r.ok) {
      setCachedData(prev => ({ ...prev, [id]: r.data }))
      setExpandedId(id)
    }
    await loadSubs()
  }

  const saveEditContent = async (id: string) => {
    setLoading(true)
    const r = await api(`/api/subscriptions/${id}/fetch`, {
      method: 'POST',
      body: JSON.stringify({ content: editContent }),
    })
    if (r.ok) {
      setCachedData(prev => ({ ...prev, [id]: r.data }))
      setExpandedId(id)
      setEditContentId(null)
      await loadSubs()
    } else {
      setSubMsg('❌ ' + (r.error || '更新失败'))
    }
    setLoading(false)
  }

  const deleteSub = async (id: string) => {
    await api(`/api/subscriptions/${id}`, { method: 'DELETE' })
    setDeleteConfirmId(null)
    setCachedData(prev => { const n = { ...prev }; delete n[id]; return n })
    setActiveSub(null)
    loadSubs()
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
      setSubMsg('❌ ' + (r.error || '聚合失败'))
    }
    setLoading(false)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-4">📡 订阅管理</h2>

      {subMsg && (
        <div className="mb-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
          <span className="text-sm text-red-400">{subMsg}</span>
          <button onClick={() => setSubMsg('')} className="ml-auto text-red-400 hover:text-red-300 text-sm">✕</button>
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-xl p-4 mb-6 border border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">添加订阅</h3>
          <div className="flex gap-1 text-xs">
            {(['link', 'content'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)}
                className={`px-2 py-1 rounded ${inputMode === m ? 'bg-[var(--accent)] text-white' : 'bg-gray-500/10 text-gray-400'}`}>
                {m === 'link' ? '订阅链接' : '粘贴内容'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 mb-3">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="名称"
            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          {inputMode === 'link' ? (
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="Clash 订阅地址"
              className="flex-[2] bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          ) : (
            <input readOnly value={content ? `📄 已粘贴内容（${content.length} 字符）` : ''}
              onClick={() => { setModalContent(content); setShowContentModal(true) }}
              placeholder="点击粘贴订阅内容"
              className="flex-[2] bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm cursor-pointer select-none" />
          )}
        </div>
        {/* ── UA 设置：本订阅 + 全局 ── */}
        <div className="rounded-lg border border-[var(--border)] p-3 mb-3">
          <div className="text-xs font-semibold text-gray-400 mb-2">🤖 User-Agent 设置</div>
          <div className="flex items-end gap-3 mb-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">本订阅（留空使用全局）</label>
              <input value={subUA} onChange={e => setSubUA(e.target.value)}
                placeholder="mihomo.party/v2.0.0 (clash.meta)"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">全局（作用于所有订阅，留空使用默认）</label>
              <input value={fetchUA} onChange={e => { setFetchUA(e.target.value); setUaSaved('') }}
                placeholder="mihomo.party/v2.0.0 (clash.meta)"
                title="部分机场在 Cloudflare 上按 UA 拦截非订阅客户端，需使用订阅客户端 UA"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <button onClick={() => saveFetchSettings('ua')}
              className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 shrink-0">
              {uaSaved === 'ua' ? '✓ 已保存' : '保存 UA'}
            </button>
          </div>
        </div>

        {/* ── 代理设置：勾选框 + 本订阅 + 全局 ── */}
        <div className="rounded-lg border border-[var(--border)] p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-400">🛡️ 代理设置</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none ml-2"
              title="勾选：拉取订阅走代理；不勾选：直连">
              <input type="checkbox" checked={useProxy} onChange={e => setUseProxy(e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)]" />
              <span className="text-sm text-gray-300">使用代理拉取</span>
            </label>
            <span className="text-xs text-gray-500">（未配置外部代理时走容器内 sing-box 当前订阅节点）</span>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">本订阅外部代理（留空使用全局，none=禁用）</label>
              <input value={subProxy} onChange={e => setSubProxy(e.target.value)}
                placeholder="http://172.17.0.1:7890 或 none"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">全局外部代理（作用于所有订阅，留空走内置 sing-box）</label>
              <input value={fetchProxy} onChange={e => { setFetchProxy(e.target.value); setUaSaved('') }}
                placeholder="http://172.17.0.1:7890 或 http://<宿主机IP>:7890"
                title="首次使用无节点时可配宿主机/其他机器代理（docker 容器内经 NAT 可访问局域网代理）"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <button onClick={() => saveFetchSettings('proxy')}
              className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 shrink-0">
              {uaSaved === 'proxy' ? '✓ 已保存' : '保存代理'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
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
              {sub.content && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono">
                  内容
                </span>
              )}
              <span className="font-semibold">{sub.name}
                {activeSub === sub.id && <span className="ml-2 text-xs text-green-400">● 当前</span>}
              </span>
              {sub.use_proxy ? (
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 shrink-0 cursor-pointer"
                  title={`点击切换为直连。当前拉取路径：${sub.external_proxy ? (sub.external_proxy === 'none' ? '内置 sing-box（本订阅禁用外部代理）' : `外部代理 ${sub.external_proxy}（本订阅）`) : (fetchProxy.trim() ? `外部代理 ${fetchProxy.trim()}（全局）` : '内置 sing-box（全局未配置外部代理）')}`}
                  onClick={async () => {
                    await api(`/api/subscriptions/${sub.id}/proxy`, { method: 'PUT', body: JSON.stringify({ use_proxy: !sub.use_proxy }) })
                    loadSubs()
                  }}>
                  代理·{(sub.external_proxy && sub.external_proxy !== 'none') ? '外部' : (sub.external_proxy === 'none' ? '内置' : (fetchProxy.trim() ? '外部' : '内置'))}
                </span>
              ) : (
                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-500/20 text-gray-400 shrink-0 cursor-pointer"
                  title="点击切换为代理（走外部代理或容器内 sing-box）" onClick={async () => {
                    await api(`/api/subscriptions/${sub.id}/proxy`, { method: 'PUT', body: JSON.stringify({ use_proxy: !sub.use_proxy }) })
                    loadSubs()
                  }}>
                  直连
                </span>
              )}
              {sub.node_count > 0 && (
                <span className="text-xs text-gray-400">({sub.node_count} 节点)</span>
              )}
              {sub.total > 0 && (
                <span className="text-xs text-gray-400 shrink-0 ml-1">
                  已用 {fmtBytes(sub.upload + sub.download)} / {fmtBytes(sub.total)}
                  {sub.expire > 0 && <span className="ml-2 text-gray-500">{fmtExpire(sub.expire)}</span>}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEditSub(sub)}
                className="bg-gray-500/20 text-gray-300 px-3 py-1 rounded text-xs hover:bg-gray-500/30">编辑</button>
              <button onClick={() => fetchSub(sub.id)} disabled={updatingId === sub.id}
                className="bg-[var(--accent)] text-white px-3 py-1 rounded text-xs hover:opacity-90 disabled:opacity-50">
                {updatingId === sub.id ? '更新中...' : '更新'}
              </button>
              <button onClick={() => applySub(sub.id)} disabled={sub.node_count === 0}
                className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:opacity-90 disabled:opacity-50">应用</button>
              <button onClick={() => toggleDetail(sub.id)}
                className="bg-gray-500/20 text-gray-300 px-3 py-1 rounded text-xs hover:bg-gray-500/30">
                {expandedId === sub.id ? '收起' : '详情'}
              </button>
              <button onClick={() => setDeleteConfirmId(sub.id)}
                className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30">删除</button>
            </div>
          </div>
          <div className="text-xs text-gray-500 truncate">{sub.url || (sub.content ? '(粘贴内容订阅)' : '')}</div>

          {/* 内容型订阅的内联编辑器（更新时粘贴新内容） */}
          {editContentId === sub.id && (
            <div className="mt-2 border border-cyan-500/30 rounded-lg p-2 bg-[#0f1419]">
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                placeholder="粘贴订阅内容（base64 或节点列表），留空则重新解析已存内容"
                rows={5}
                className="w-full bg-transparent text-xs font-mono resize-y outline-none" />
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => setEditContentId(null)}
                  className="bg-gray-500/20 text-gray-300 px-3 py-1 rounded text-xs hover:bg-gray-500/30">取消</button>
                <button onClick={() => saveEditContent(sub.id)} disabled={loading}
                  className="bg-cyan-600 text-white px-3 py-1 rounded text-xs hover:opacity-90 disabled:opacity-50">
                  {loading ? '解析中...' : '解析并更新'}
                </button>
              </div>
            </div>
          )}

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
                      {n.is_info && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 shrink-0">信息</span>
                      )}
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

      {/* 删除确认弹窗 */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">🗑️ 删除订阅</h3>
            <p className="text-sm text-gray-400 mb-4">
              确定删除「{subs.find(s => s.id === deleteConfirmId)?.name || '该订阅'}」吗？删除后不可恢复。
              {activeSub === deleteConfirmId && <span className="block mt-1 text-amber-400">⚠ 这是当前应用的订阅，删除后应用标记将清除（节点继续运行）。</span>}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirmId(null)}
                className="bg-gray-500/20 text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-500/30">取消</button>
              <button onClick={() => deleteSub(deleteConfirmId)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑订阅弹窗 */}
      {editSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setEditSub(null)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 w-full max-w-lg"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">✏️ 编辑订阅</h3>

            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 block">名称</label>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </div>

            <label className="flex items-center gap-2 cursor-pointer mb-3 select-none">
              <input type="checkbox" checked={editUseProxy} onChange={e => setEditUseProxy(e.target.checked)}
                className="w-4 h-4 accent-[var(--accent)]" />
              <span className="text-sm text-gray-300">使用代理拉取</span>
              <span className="text-xs text-gray-500">（未配置外部代理时走容器内 sing-box 当前订阅节点）</span>
            </label>

            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 block">User-Agent（留空使用全局设置）</label>
              <input value={editUA} onChange={e => setEditUA(e.target.value)}
                placeholder="mihomo.party/v2.0.0 (clash.meta)"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">外部代理（留空使用全局设置，none=禁用外部代理走内置）</label>
              <input value={editProxy} onChange={e => setEditProxy(e.target.value)}
                placeholder="http://172.17.0.1:7890 或 none"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditSub(null)}
                className="bg-gray-500/20 text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-500/30">取消</button>
              <button onClick={saveEditSub} disabled={loading || !editName.trim()}
                className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内容粘贴弹窗 */}
      {showContentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setShowContentModal(false)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 w-full max-w-lg"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">📄 粘贴订阅内容</h3>
            <textarea autoFocus value={modalContent} onChange={e => setModalContent(e.target.value)}
              placeholder="粘贴订阅返回内容（base64 或 vmess://、vless:// 等节点列表）"
              rows={10}
              className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono resize-y outline-none" />
            <div className="flex gap-2 justify-end mt-3">
              <button onClick={() => setShowContentModal(false)}
                className="bg-gray-500/20 text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-500/30">取消</button>
              <button onClick={() => { setContent(modalContent); setShowContentModal(false) }}
                disabled={!modalContent.trim()}
                className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
