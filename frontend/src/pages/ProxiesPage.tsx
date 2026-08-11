
import { useState, useEffect, useCallback } from 'react'
import { api, notifySidebar } from '@/components/SidebarStatus'

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<any[]>([])
  const [current, setCurrent] = useState('')

  const load = useCallback(async () => {
    const [pr, st] = await Promise.all([api('/api/proxies'), api('/api/status')])
    if (pr.ok) setProxies(pr.data.proxies || [])
    if (st.ok) {
      setCurrent(st.data.current || '')
      notifySidebar(st.data)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 节点列表只读展示：切换节点请到「出站组管理」中选择组内成员

  const grouped: Record<string, any[]> = {}
  proxies.forEach(p => {
    const region = p.region || '其他'
    if (!grouped[region]) grouped[region] = []
    grouped[region].push(p)
  })
  const sortedRegions = Object.keys(grouped).sort((a, b) => {
    if (a === '其他') return 1
    if (b === '其他') return -1
    return grouped[b].length - grouped[a].length
  })

  return (
    <div className="max-w-2xl">
        <h2 className="text-xl font-bold mb-4">🔗 节点列表 ({proxies.length})</h2>
        {sortedRegions.map(region => {
          const nodes = grouped[region].sort((a: any, b: any) => a.tag.localeCompare(b.tag))
          if (!nodes?.length) return null
          return (
            <div key={region} className="mb-4">
              <div className="text-sm font-semibold text-gray-400 mb-2 border-l-2 border-[var(--accent)] pl-3">
                {region} ({nodes.length})
              </div>
              <div className="space-y-1">
                {nodes.map((p, i) => (
                  <div
                    key={i}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                      p.tag === current
                        ? 'bg-[var(--accent)]/20 border-l-2 border-[var(--accent)]'
                        : 'bg-[var(--surface)] border-l-2 border-transparent'
                    }`}
                  >
                    <span className="truncate">{p.tag}</span>
                    <span className="flex items-center gap-2 shrink-0 ml-2">
                      {p.tag === current && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">当前</span>
                      )}
                      <span className="text-xs text-gray-500">{p.type}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
  )
}
