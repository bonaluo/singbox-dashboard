'use client'

import { useState, useEffect } from 'react'
import { api } from '@/components/Sidebar'

interface GroupRule {
  name: string
  type: string
  pattern?: string
  proxies?: string[]
  defaults?: string[]
  sort_order: number
}

const defaultRule: GroupRule = {
  name: '',
  type: 'urltest',
  pattern: '',
  proxies: [],
  defaults: ['DIRECT'],
  sort_order: 0,
}

export default function GroupRulesPage() {
  const [rules, setRules] = useState<GroupRule[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [editRule, setEditRule] = useState<GroupRule>({ ...defaultRule })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const loadRules = async () => {
    const r = await api('/api/group-rules')
    if (r.ok) setRules(r.data || [])
  }

  useEffect(() => { loadRules() }, [])

  const startEdit = (i: number) => {
    setEditing(i)
    setEditRule({ ...rules[i] })
  }

  const addNew = () => {
    const newRule = { ...defaultRule, sort_order: rules.length }
    setEditing(rules.length)
    setEditRule(newRule)
  }

  const deleteRule = (i: number) => {
    const next = rules.filter((_, idx) => idx !== i)
    setRules(next)
    setEditing(null)
    setEditRule({ ...defaultRule })
  }

  const saveRule = () => {
    if (!editRule.name) return
    const next = [...rules]
    if (editing !== null && editing < rules.length) {
      next[editing] = { ...editRule }
    } else {
      next.push({ ...editRule })
    }
    setRules(next)
    setEditing(null)
    setEditRule({ ...defaultRule })
  }

  const saveAllToServer = async () => {
    setLoading(true)
    setMsg('')
    const r = await api('/api/group-rules', {
      method: 'POST',
      body: JSON.stringify({ rules }),
    })
    if (r.ok) {
      setMsg('✅ 分组规则已保存')
    } else {
      setMsg(r.error || '保存失败')
    }
    setLoading(false)
  }

  const applyRules = async () => {
    setLoading(true)
    setMsg('')
    const r = await api('/api/group-rules/apply', { method: 'POST' })
    if (r.ok) {
      setMsg('✅ 分组规则已应用到 sing-box')
    } else {
      setMsg(r.error || '应用失败')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">📋 分组规则</h2>
        <div className="flex gap-2">
          <button onClick={addNew}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
            + 添加规则
          </button>
          <button onClick={saveAllToServer} disabled={loading || rules.length === 0}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? '保存中...' : '💾 保存全部'}
          </button>
          <button onClick={applyRules} disabled={loading || rules.length === 0}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? '应用中...' : '▶ 立即应用'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="text-sm mb-3 text-green-400">{msg}</div>
      )}

      <p className="text-xs text-gray-500 mb-4">
        定义正则分组规则，每次应用订阅后自动创建/更新出站组。
        规则按 sort_order 顺序执行，pattern 匹配节点 tag，matches 与已有的出站组名。
        下方预览仅供编辑，点击「保存全部」后再点「立即应用」生效。
      </p>

      {/* 编辑面板 */}
      {editing !== null && (
        <div className="bg-[var(--surface)] rounded-xl p-4 mb-4 border border-[var(--accent)]/30">
          <h3 className="font-semibold mb-3">
            {editing < rules.length ? '编辑规则' : '添加规则'}
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">组名称</label>
              <input value={editRule.name} onChange={e => setEditRule({ ...editRule, name: e.target.value })}
                placeholder="例如: 香港"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">类型</label>
              <select value={editRule.type} onChange={e => setEditRule({ ...editRule, type: e.target.value })}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm">
                <option value="urltest">URLTest（自动选低延迟）</option>
                <option value="selector">Selector（手动选择）</option>
                <option value="loadbalance">LoadBalance（负载均衡）</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                正则匹配模式 <span className="text-gray-600">（空=用显式列表）</span>
              </label>
              <input value={editRule.pattern || ''} onChange={e => setEditRule({ ...editRule, pattern: e.target.value })}
                placeholder='例如: (HK|香港)'
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                显式出站列表 <span className="text-gray-600">（逗号分隔，替代正则）</span>
              </label>
              <input value={(editRule.proxies || []).join(',')} onChange={e => setEditRule({ ...editRule, proxies: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder='例如: 全部-速度优先, DIRECT'
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                默认出站 <span className="text-gray-600">（逗号分隔，正则匹配后追加）</span>
              </label>
              <input value={(editRule.defaults || []).join(',')} onChange={e => setEditRule({ ...editRule, defaults: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder='例如: DIRECT'
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">排序</label>
              <input type="number" value={editRule.sort_order} onChange={e => setEditRule({ ...editRule, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveRule}
              disabled={!editRule.name}
              className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
              {editing < rules.length ? '更新' : '添加'}
            </button>
            <button onClick={() => { setEditing(null); setEditRule({ ...defaultRule }) }}
              className="text-gray-400 px-4 py-2 rounded-lg text-sm hover:text-gray-200">
              取消
            </button>
            {editing < rules.length && (
              <button onClick={() => deleteRule(editing)}
                className="text-red-400 px-4 py-2 rounded-lg text-sm hover:text-red-300 ml-auto">
                删除
              </button>
            )}
          </div>
        </div>
      )}

      {/* 规则列表 */}
      {rules.length === 0 && !editing && (
        <div className="text-gray-500 text-sm py-12 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)]">
          暂无分组规则，点击「+ 添加规则」创建
        </div>
      )}

      {rules.map((rule, i) => (
        <div key={i} className="bg-[var(--surface)] rounded-xl p-4 mb-2 border border-[var(--border)] hover:border-gray-600 cursor-pointer transition-colors"
          onClick={() => startEdit(i)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-6">#{rule.sort_order}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                rule.type === 'urltest' ? 'bg-purple-500/20 text-purple-400' : rule.type === 'loadbalance' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
              }`}>
                {rule.type === 'urltest' ? 'URL' : rule.type === 'loadbalance' ? 'LB' : 'SEL'}
              </span>
              <span className="font-medium text-sm">{rule.name}</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1 ml-8">
            {rule.pattern ? (
              <><span className="font-mono text-[var(--accent)]">/{rule.pattern}/</span> 匹配节点</>
            ) : rule.proxies && rule.proxies.length > 0 ? (
              <>显式列表: {rule.proxies.join(', ')}</>
            ) : null}
            {rule.defaults && rule.defaults.length > 0 && (
              <> + 默认: {rule.defaults.join(', ')}</>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
