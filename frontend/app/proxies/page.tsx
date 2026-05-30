'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/components/Sidebar'

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<any[]>([])
  const [current, setCurrent] = useState('')
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    const [pr, st] = await Promise.all([api('/api/proxies'), api('/api/status')])
    if (pr.ok) setProxies(pr.data.proxies || [])
    if (st.ok) setCurrent(st.data.current || '')
  }, [])

  useEffect(() => { load() }, [load])

  const switchProxy = async (tag: string) => {
    setSwitching(true)
    const r = await api('/api/proxies/switch', {
      method: 'POST',
      body: JSON.stringify({ tag }),
    })
    if (r.ok) { setCurrent(tag); load() }
    setSwitching(false)
  }

  const grouped: Record<string, any[]> = {}
  proxies.forEach(p => {
    const region = p.region || '其他'
    if (!grouped[region]) grouped[region] = []
    grouped[region].push(p)
  })
  const regionOrder = ['新加坡','香港','日本','美国','台湾','印度','澳大利亚','英国','加拿大','德国','法国','其他']

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold mb-4">🔗 节点列表 ({proxies.length})</h2>

      {regionOrder.map(region => {
        const nodes = grouped[region]
        if (!nodes?.length) return null
        return (
          <div key={region} className="mb-4">
            <div className="text-sm font-semibold text-gray-400 mb-2 border-l-2 border-[var(--accent)] pl-3">
              {region} ({nodes.length})
            </div>
            <div className="space-y-1">
              {nodes.map((p, i) => (
                <button
                  key={i}
                  onClick={() => switchProxy(p.tag)}
                  disabled={switching}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    p.tag === current
                      ? 'bg-[var(--accent)]/20 border-l-2 border-[var(--accent)]'
                      : 'bg-[var(--surface)] border-l-2 border-transparent hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span className="truncate">{p.tag}</span>
                  <span className="text-xs text-gray-500 ml-2">{p.type}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
