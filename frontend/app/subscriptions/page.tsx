1|'use client'
2|
3|import { useState, useEffect, useCallback } from 'react'
4|import { api } from '@/components/Sidebar'
5|
6|export default function SubscriptionsPage() {
7|  const [subs, setSubs] = useState<any[]>([])
8|  const [name, setName] = useState('')
9|  const [url, setUrl] = useState('')
const [loading, setLoading] = useState(false)
const [parsedData, setParsedData] = useState<any>(null)
const [activeSub, setActiveSub] = useState<string | null>(null)
12|  const [showRaw, setShowRaw] = useState(false)
13|
14|  const loadSubs = useCallback(async () => {
15|    const r = await api('/api/subscriptions')
16|    if (r.ok) setSubs(r.data.subscriptions || [])
17|  }, [])
18|
19|  useEffect(() => { loadSubs() }, [loadSubs])
20|
21|  const addSub = async () => {
22|    if (!name || !url) return
23|    setLoading(true)
24|    const r = await api('/api/subscriptions', {
25|      method: 'POST',
26|      body: JSON.stringify({ name, url }),
27|    })
28|    if (r.ok) {
29|      setName(''); setUrl('')
30|      loadSubs()
31|    }
32|    setLoading(false)
33|  }
34|
35|  const deleteSub = async (id: string) => {
36|    await api(`/api/subscriptions/${id}`, { method: 'DELETE' })
37|    loadSubs()
38|  }
39|
40|  const fetchSub = async (id: string) => {
41|    setLoading(true)
42|    const r = await api(`/api/subscriptions/${id}/fetch`, { method: 'POST' })
43|    if (r.ok) setParsedData(r.data)
44|    setLoading(false)
45|  }
46|
47|
  const applySub = async (id: string) => {
    setLoading(true)
    const r = await api(`/api/subscriptions/${id}/apply`, { method: 'POST' })
    if (r.ok) {
      setActiveSub(id)
      alert('✓ ' + (r.data?.msg || '订阅已应用，服务已重启'))
    } else {
      alert('✗ ' + (r.error || '应用失败'))
    }
    setLoading(false)
  }
  return (
48|    <div className="max-w-4xl">
49|      <h2 className="text-xl font-bold mb-4">📡 订阅管理</h2>
50|
51|      {/* 添加订阅 */}
52|      <div className="bg-[var(--surface)] rounded-xl p-4 mb-6 border border-[var(--border)]">
53|        <h3 className="font-semibold mb-3">添加订阅</h3>
54|        <div className="flex gap-3 mb-3">
55|          <input
56|            value={name} onChange={e => setName(e.target.value)}
57|            placeholder="名称 (如: KTMWAN)"
58|            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
59|          />
60|          <input
61|            value={url} onChange={e => setUrl(e.target.value)}
62|            placeholder="Clash 订阅地址"
63|            className="flex-[2] bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
64|          />
65|        </div>
66|        <button onClick={addSub} disabled={loading}
67|          className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
68|          {loading ? '添加中...' : '添加订阅'}
69|        </button>
70|      </div>
71|
72|      {/* 订阅列表 */}
73|      <div className="space-y-3">
74|        {subs.map(sub => (
75|          <div key={sub.id} className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
76|            <div className="flex items-center justify-between mb-2">
77|              <div>
78|                <span className="font-semibold">{sub.name}</span>
79|                {sub.node_count > 0 && (
80|                  <span className="ml-2 text-xs text-gray-400">({sub.node_count} 个节点)</span>
81|                )}
82|              </div>
83|              <div className="flex gap-2">
84|                <button onClick={() => fetchSub(sub.id)}
85|                  className="bg-[var(--accent)] text-white px-3 py-1 rounded text-xs hover:opacity-90">
86|                  拉取解析
87|                </button>
88|                <button onClick={() => deleteSub(sub.id)}
89|                  className="bg-red-500/20 text-red-400 px-3 py-1 rounded text-xs hover:bg-red-500/30">
90|                  删除
91|                </button>
92|              </div>
93|            </div>
94|            <div className="text-xs text-gray-500 truncate">{sub.url}</div>
95|            {sub.last_updated && (
96|              <div className="text-xs text-gray-500 mt-1">最后更新: {sub.last_updated}</div>
97|            )}
98|          </div>
99|        ))}
100|      </div>
101|
102|      {/* 解析结果 */}
103|      {parsedData && (
104|        <div className="mt-6 bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
105|          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
106|            <h3 className="font-semibold">
107|              解析结果 — {parsedData.node_count} 个节点
108|            </h3>
109|            <button
110|              onClick={() => setShowRaw(!showRaw)}
111|              className="text-xs text-[var(--accent)] hover:underline">
112|              {showRaw ? '查看结构化' : '查看原始数据'}
113|            </button>
114|          </div>
115|
116|          {showRaw ? (
117|            <div className="p-4">
118|              <div className="bg-[#0f1419] rounded-lg p-3 font-mono text-xs max-h-96 overflow-auto whitespace-pre-wrap">
119|                {parsedData.raw_lines.join('\n')}
120|              </div>
121|            </div>
122|          ) : (
123|            <div className="p-4">
124|              <div className="grid gap-2">
125|                {parsedData.nodes?.slice(0, 50).map((n: any, i: number) => (
126|                  <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-[var(--border)]/50 last:border-0">
127|                    <span className="text-xs text-gray-500 w-6">{i + 1}</span>
128|                    <span className="w-20 text-xs text-gray-400">{n.region}</span>
129|                    <span className="flex-1 truncate">{n.tag}</span>
130|                    <span className="text-xs text-gray-500">{n.type}</span>
131|                    <span className="text-xs text-gray-500">{n.server}:{n.port}</span>
132|                  </div>
133|                ))}
134|              </div>
135|            </div>
136|          )}
137|        </div>
138|      )}
139|    </div>
140|  )
141|}
142|