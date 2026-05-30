'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/components/Sidebar'

const RULE_TYPES = [
  { value: 'domain', label: '域名(精确)' },
  { value: 'domain-suffix', label: '域名(后缀)' },
  { value: 'domain-keyword', label: '域名(关键词)' },
  { value: 'ip-cidr', label: 'IP CIDR' },
  { value: 'geosite', label: 'GeoSite' },
  { value: 'geoip', label: 'GeoIP' },
  { value: 'process-name', label: '进程名' },
]

export default function RulesPage() {
  const [rules, setRules] = useState<any[]>([])
  const [outbounds, setOutbounds] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'domain-suffix', value: '', outbound: 'proxy', comment: '' })
  const [loading, setLoading] = useState(false)

  const loadRules = useCallback(async () => {
    const r = await api('/api/rules')
    if (r.ok) setRules(r.data.rules || [])

    const o = await api('/api/rules/options')
    if (o.ok) setOutbounds(o.data.outbounds || [])
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const addRule = async () => {
    if (!form.value) return
    setLoading(true)
    await api('/api/rules', {
      method: 'POST',
      body: JSON.stringify({ ...form, enabled: true, priority: rules.length + 1 }),
    })
    setForm({ type: 'domain-suffix', value: '', outbound: 'proxy', comment: '' })
    setShowForm(false)
    loadRules()
    setLoading(false)
  }

  const deleteRule = async (id: string) => {
    await api(`/api/rules/${id}`, { method: 'DELETE' })
    loadRules()
  }

  const toggleRule = async (rule: any) => {
    await api(`/api/rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
    })
    loadRules()
  }

  const applyRules = async () => {
    setLoading(true)
    await api('/api/rules/apply', { method: 'POST' })
    setLoading(false)
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">📋 规则配置</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(!showForm)}
            className="bg-[var(--surface)] border border-[var(--border)] px-4 py-2 rounded-lg text-sm hover:bg-[var(--surface-hover)]">
            {showForm ? '取消' : '+ 添加规则'}
          </button>
          <button onClick={applyRules} disabled={loading}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? '应用...' : '应用规则'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-[var(--surface)] rounded-xl p-4 mb-4 border border-[var(--border)]">
          <div className="grid grid-cols-4 gap-3">
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm">
              {RULE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}
              placeholder="匹配值" className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            <select value={form.outbound} onChange={e => setForm({ ...form, outbound: e.target.value })}
              className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm">
              {outbounds.slice(0, 10).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })}
              placeholder="备注" className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={addRule} disabled={loading}
            className="mt-3 bg-[var(--accent)] text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            添加
          </button>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-gray-500 text-sm py-8 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)]">
            暂无规则。点击"添加规则"创建路由规则
          </div>
        )}
        {rules.map((rule, i) => (
          <div key={rule.id} className={`flex items-center gap-3 bg-[var(--surface)] rounded-xl p-3 border border-[var(--border)] ${!rule.enabled ? 'opacity-50' : ''}`}>
            <span className="text-xs text-gray-500 w-6">{i + 1}</span>
            <button onClick={() => toggleRule(rule)}
              className={`w-10 h-6 rounded-full transition-colors relative ${rule.enabled ? 'bg-green-500' : 'bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
            </button>
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] w-28 text-center">
              {RULE_TYPES.find(t => t.value === rule.type)?.label || rule.type}
            </span>
            <code className="flex-1 text-sm text-gray-300">{rule.value}</code>
            <span className="text-xs text-gray-500">{rule.outbound}</span>
            {rule.comment && <span className="text-xs text-gray-600">{rule.comment}</span>}
            <button onClick={() => deleteRule(rule.id)}
              className="text-red-500 hover:text-red-400 text-sm">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
