'use client'

import { useState } from 'react'

interface OutboundOption {
  tag: string
  type: string
  now?: string
  delay?: number
}

export default function OutboundSelectorModal({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: OutboundOption[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  const typeColor = (t: string) => {
    const map: Record<string, string> = {
      direct: 'bg-green-500/20 text-green-400',
      selector: 'bg-blue-500/20 text-blue-400',
      urltest: 'bg-purple-500/20 text-purple-400',
      loadbalance: 'bg-green-500/20 text-green-400',
      vmess: 'bg-orange-500/20 text-orange-400',
      vless: 'bg-cyan-500/20 text-cyan-400',
      shadowsocks: 'bg-teal-500/20 text-teal-400',
      trojan: 'bg-pink-500/20 text-pink-400',
    }
    return map[t] || 'bg-gray-500/20 text-gray-400'
  }

  const delayColor = (d?: number) => {
    if (!d || d <= 0) return 'text-gray-600'
    if (d < 200) return 'text-green-400'
    if (d < 500) return 'text-yellow-400'
    return 'text-red-400'
  }

  const typeLabel = (t: string) => {
    const short: Record<string, string> = {
      urltest: 'URL',
      selector: 'SEL',
      direct: 'DIR',
      vmess: 'VM',
      vless: 'VL',
      shadowsocks: 'SS',
      trojan: 'TJ',
    }
    return short[t] || t.slice(0, 3).toUpperCase()
  }

  // 按类型分组：组在前，单节点在后
  const groups = options.filter(o => o.type === 'selector' || o.type === 'urltest' || o.type === 'direct')
  const nodes = options.filter(o => o.type !== 'selector' && o.type !== 'urltest' && o.type !== 'direct')

  const selected = options.find(o => o.tag === value)

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm flex items-center gap-2 disabled:opacity-40 transition-colors hover:border-gray-600"
      >
        {selected ? (
          <>
            <span className={`text-[10px] px-1 py-0.5 rounded font-mono shrink-0 ${typeColor(selected.type)}`}>
              {typeLabel(selected.type)}
            </span>
            <span className="flex-1 text-left truncate">{selected.tag}</span>
            {selected.now && (
              <span className="text-xs text-gray-500 truncate max-w-[100px]" title={selected.now}>
                → {selected.now.length > 16 ? selected.now.slice(0, 14) + '…' : selected.now}
              </span>
            )}
            {selected.delay !== undefined && selected.delay > 0 && (
              <span className={`text-[11px] font-mono shrink-0 ${delayColor(selected.delay)}`}>
                {selected.delay}ms
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-500">点击选择出站</span>
        )}
        <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" />

          {/* Modal panel */}
          <div
            className="relative w-full max-w-xl max-h-[80vh] bg-[#0f1419] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
              <h3 className="text-base font-semibold">选择出站节点</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-300 text-lg transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
              {/* 组（selector / urltest / direct） */}
              {groups.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">出站组</div>
                  <div className="grid grid-cols-2 gap-2">
                    {groups.map(ob => (
                      <button
                        key={ob.tag}
                        onClick={() => { onChange(ob.tag); setOpen(false) }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition-all text-left ${
                          ob.tag === value
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]'
                            : 'border-[var(--border)] hover:border-gray-600 hover:bg-[var(--surface)]'
                        }`}
                      >
                        <span className={`text-[10px] px-1 py-0.5 rounded font-mono shrink-0 ${typeColor(ob.type)}`}>
                          {typeLabel(ob.type)}
                        </span>
                        <span className="flex-1 truncate font-medium">{ob.tag}</span>
                        {ob.now && (
                          <span className="text-xs text-gray-500 truncate max-w-[80px]">
                            {ob.now.length > 10 ? ob.now.slice(0, 8) + '…' : ob.now}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 单个节点 */}
              {nodes.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2 font-medium">节点</div>
                  <div className="grid grid-cols-2 gap-2">
                    {nodes.map(ob => (
                      <button
                        key={ob.tag}
                        onClick={() => { onChange(ob.tag); setOpen(false) }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition-all text-left ${
                          ob.tag === value
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]'
                            : 'border-[var(--border)] hover:border-gray-600 hover:bg-[var(--surface)]'
                        }`}
                      >
                        <span className={`text-[10px] px-1 py-0.5 rounded font-mono shrink-0 ${typeColor(ob.type)}`}>
                          {typeLabel(ob.type)}
                        </span>
                        <span className="flex-1 truncate">{ob.tag}</span>
                        {ob.delay !== undefined && ob.delay > 0 && (
                          <span className={`text-[11px] font-mono shrink-0 ${delayColor(ob.delay)}`}>
                            {ob.delay}ms
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-[var(--border)] px-5 py-3 shrink-0">
              <button
                onClick={() => setOpen(false)}
                className="w-full bg-gray-700 text-white py-2 rounded-lg text-sm hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
