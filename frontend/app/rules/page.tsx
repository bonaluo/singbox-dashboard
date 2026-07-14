'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '@/components/Sidebar'
import OutboundSelectorModal from '@/components/OutboundSelectorModal'
import NodeTestModal from '@/components/NodeTestModal'

// ── 类型 ──

interface OutboundOption {
  tag: string
  type: string
  now?: string
  delay?: number
}

// ── sing-box route rule 全部匹配字段 ──
// 参考: https://sing-box.sagernet.org/configuration/route/rule/
const CONDITION_TYPES = [
  {
    group: '域名 / IP',
    items: [
      { value: 'domain', label: 'domain - 精确域名', hint: 'example.com' },
      { value: 'domain_suffix', label: 'domain_suffix - 域名后缀', hint: '.cn' },
      { value: 'domain_keyword', label: 'domain_keyword - 域名关键词', hint: 'google' },
      { value: 'domain_regex', label: 'domain_regex - 域名正则', hint: '^stun\\..+' },
      { value: 'geosite', label: 'geosite - 地理站点集', hint: 'cn' },
      { value: 'geoip', label: 'geoip - 目标 GeoIP', hint: 'cn' },
      { value: 'source_geoip', label: 'source_geoip - 源 GeoIP', hint: 'private' },
      { value: 'ip_cidr', label: 'ip_cidr - 目标 IP CIDR', hint: '10.0.0.0/24' },
      { value: 'source_ip_cidr', label: 'source_ip_cidr - 源 IP CIDR', hint: '192.168.0.0/16' },
      { value: 'ip_is_private', label: 'ip_is_private - 目标私有IP', hint: 'true' },
      { value: 'source_ip_is_private', label: 'source_ip_is_private - 源私有IP', hint: 'true' },
    ],
  },
  {
    group: '端口',
    items: [
      { value: 'port', label: 'port - 目标端口', hint: '80,443' },
      { value: 'port_range', label: 'port_range - 端口范围', hint: '1000:2000' },
      { value: 'source_port', label: 'source_port - 源端口', hint: '12345' },
      { value: 'source_port_range', label: 'source_port_range - 源端口范围', hint: ':3000' },
    ],
  },
  {
    group: '进程 / 用户 / 入站',
    items: [
      { value: 'process_name', label: 'process_name - 进程名', hint: 'curl' },
      { value: 'process_path', label: 'process_path - 进程路径', hint: '/usr/bin/curl' },
      { value: 'process_path_regex', label: 'process_path_regex - 路径正则', hint: '^/usr/bin/.+' },
      { value: 'package_name', label: 'package_name - Android 包名', hint: 'com.termux' },
      { value: 'package_name_regex', label: 'package_name_regex - 包名正则', hint: '^com\\.termux.*' },
      { value: 'user', label: 'user - 用户名', hint: 'sekai' },
      { value: 'user_id', label: 'user_id - 用户 ID', hint: '1000' },
      { value: 'inbound', label: 'inbound - 入站标签', hint: 'mixed-in' },
    ],
  },
  {
    group: '协议 / 网络',
    items: [
      { value: 'protocol', label: 'protocol - 协议', hint: 'tls' },
      { value: 'client', label: 'client - 客户端类型', hint: 'chromium' },
      { value: 'network', label: 'network - 网络类型', hint: 'tcp' },
      { value: 'network_type', label: 'network_type - 网络类型', hint: 'wifi' },
      { value: 'network_is_expensive', label: 'network_is_expensive - 计费网络', hint: 'true' },
      { value: 'network_is_constrained', label: 'network_is_constrained - 受限网络', hint: 'true' },
      { value: 'ip_version', label: 'ip_version - IP 版本', hint: '4' },
      { value: 'auth_user', label: 'auth_user - 认证用户', hint: 'usera' },
      { value: 'clash_mode', label: 'clash_mode - Clash 模式', hint: 'direct' },
    ],
  },
  {
    group: 'WiFi / 接口 / 其他',
    items: [
      { value: 'wifi_ssid', label: 'wifi_ssid - WiFi SSID', hint: 'MyWIFI' },
      { value: 'wifi_bssid', label: 'wifi_bssid - WiFi BSSID', hint: '00:00:00:00:00:00' },
      { value: 'rule_set', label: 'rule_set - 规则集', hint: 'geoip-cn' },
      { value: 'rule_set_ipcidr_match_source', label: 'rule_set_ipcidr_match_source', hint: 'true' },
      { value: 'source_mac_address', label: 'source_mac_address - MAC 地址', hint: '00:11:22:33:44:55' },
      { value: 'source_hostname', label: 'source_hostname - 主机名', hint: 'my-device' },
      { value: 'preferred_by', label: 'preferred_by - 优选出口', hint: 'tailscale' },
    ],
  },
]

const ACTIONS = [
  { value: 'route', label: 'route - 路由到出站 (默认)' },
  { value: 'reject', label: 'reject - 直接拒绝' },
  { value: 'hijack-dns', label: 'hijack-dns - 劫持 DNS' },
  { value: 'sniff', label: 'sniff - 仅协议嗅探' },
]

// ── 搜索列定义 ──
const SEARCH_COLUMNS: { key: string; label: string }[] = [
  { key: 'all', label: '所有字段' },
  { key: 'type', label: '匹配字段' },
  { key: 'value', label: '匹配值' },
  { key: 'outbound', label: '动作/出站' },
  { key: 'comment', label: '备注' },
]

// ── 出站选择组件（使用 OutboundSelectorModal 弹窗） ──

// 已迁移到 components/OutboundSelectorModal.tsx 使用模态弹窗选择
// 老的 OutboundSelect 下拉选择器已被移除

// ── 主页面组件 ──

export default function RulesPage() {
  const [rules, setRules] = useState<any[]>([])
  const [outbounds, setOutbounds] = useState<OutboundOption[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // 表单: 简单模式 (单条件 type+value) 或 高级模式 (多条件 conditions)
  const [formType, setFormType] = useState('domain_suffix')
  const [formValue, setFormValue] = useState('')
  const [formAction, setFormAction] = useState('route')
  const [formOutbound, setFormOutbound] = useState('proxy')
  const [formInvert, setFormInvert] = useState(false)
  const [formComment, setFormComment] = useState('')
  const [formError, setFormError] = useState('')
  const [showTestModal, setShowTestModal] = useState(false)

  // 搜索状态
  const [searchText, setSearchText] = useState('')
  const [searchColumn, setSearchColumn] = useState<string>('all')

  // 可测试的节点（非组、非 direct 的独立节点）
  const testableNodes = outbounds.filter(
    o => o.type !== 'selector' && o.type !== 'urltest' && o.type !== 'loadbalance' && o.type !== 'direct'
  )

  const resetForm = () => {
    setFormType('domain_suffix')
    setFormValue('')
    setFormAction('route')
    setFormOutbound('proxy')
    setFormInvert(false)
    setFormComment('')
    setFormError('')
    setEditingId(null)
  }

  const loadRules = useCallback(async () => {
    const r = await api('/api/rules')
    if (r.ok) setRules(r.data.rules || [])

    const o = await api('/api/rules/options')
    if (o.ok) setOutbounds(o.data.outbounds || [])
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  // 构建请求体
  const buildRuleBody = (overrides?: { outbound?: string }) => ({
    type: formType,
    value: formValue,
    action: formAction,
    outbound: formAction === 'route' ? (overrides?.outbound ?? formOutbound) : '',
    invert: formInvert,
    comment: formComment,
    enabled: true,
    conditions: [{ type: formType, values: formValue.split(',').map((s: string) => s.trim()).filter(Boolean) }],
  })

  // 检查重复规则：完全匹配 + 值级重叠
  // editingId 为当前编辑的规则 ID，跳过自身避免误报
  const findDuplicateError = (type: string, value: string, skipId?: string): string | null => {
    const newValues = value.split(',').map(s => s.trim()).filter(Boolean)
    if (newValues.length === 0) return null

    // 检查 1：完全匹配（相同 type + 完全相同值集合），排除自身
    const normVal = [...newValues].sort().join(',')
    const exactMatch = rules.some(r => {
      if (skipId && r.id === skipId) return false
      const conds = r.conditions || []
      if (conds.length !== 1) return false
      const c = conds[0]
      if (c.type !== type) return false
      const existingVal = [...(c.values || [])].sort().join(',')
      return existingVal === normVal
    })
    if (exactMatch) return '重复规则：匹配字段和匹配值完全相同的规则已存在'

    // 检查 2：值级重叠（同类型下已有相同值），排除自身
    const overlapping: string[] = []
    for (const r of rules) {
      if (skipId && r.id === skipId) continue
      const conds = r.conditions || []
      for (const c of conds) {
        if (c.type !== type) continue
        for (const nv of newValues) {
          if ((c.values || []).includes(nv) && !overlapping.includes(nv)) {
            overlapping.push(nv)
          }
        }
      }
    }
    if (overlapping.length > 0) {
      return `值冲突：以下值已存在于其他规则中: ${overlapping.join(', ')}`
    }

    return null
  }

  // 添加/更新规则
  const saveRule = async (overrides?: { outbound?: string }) => {
    if (!formValue) return
    const dupErr = findDuplicateError(formType, formValue, editingId ?? undefined)
    if (dupErr) {
      setFormError(dupErr)
      return
    }
    setLoading(true)

    const body = buildRuleBody(overrides)
    let r

    if (editingId) {
      r = await api(`/api/rules/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...body, id: editingId }),
      })
    } else {
      r = await api('/api/rules', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    }

    if (!r.ok) {
      setFormError(r.error || '操作失败')
      setLoading(false)
      return
    }

    resetForm()
    setShowForm(false)
    loadRules()
    setLoading(false)
  }

  // 添加并应用规则
  const saveAndApplyRule = async (overrides?: { outbound?: string }) => {
    if (!formValue) return
    const dupErr = findDuplicateError(formType, formValue, editingId ?? undefined)
    if (dupErr) {
      setFormError(dupErr)
      return
    }
    setLoading(true)

    const body = buildRuleBody(overrides)
    let r

    if (editingId) {
      r = await api(`/api/rules/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...body, id: editingId }),
      })
    } else {
      r = await api('/api/rules', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    }

    if (!r.ok) {
      setFormError(r.error || '操作失败')
      setLoading(false)
      return
    }

    resetForm()
    setShowForm(false)
    await loadRules()
    // 自动应用规则
    await api('/api/rules/apply', { method: 'POST' })
    setLoading(false)
  }

  // 测试模态框回调：从 NodeTestModal 选择节点后，设置出站并保存
  const handleTestModalAdd = async (tag: string) => {
    setFormOutbound(tag)
    setShowTestModal(false)
    await saveRule({ outbound: tag })
  }

  const handleTestModalAddAndApply = async (tag: string) => {
    setFormOutbound(tag)
    setShowTestModal(false)
    await saveAndApplyRule({ outbound: tag })
  }

  const editRule = (rule: any) => {
    // 从 conditions 或旧 Type+Value 格式填充表单
    const conds = rule.conditions
    if (conds && conds.length > 0) {
      setFormType(conds[0].type || 'domain_suffix')
      setFormValue((conds[0].values || []).join(', '))
    } else {
      setFormType(rule.type || 'domain_suffix')
      setFormValue(rule.value || '')
    }
    setFormAction(rule.action || 'route')
    setFormOutbound(rule.outbound || 'proxy')
    setFormInvert(!!rule.invert)
    setFormComment(rule.comment || '')
    setEditingId(rule.id)
    setShowForm(true)
  }

  const deleteRule = async (id: string) => {
    await api(`/api/rules/${id}`, { method: 'DELETE' })
    loadRules()
  }

  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDrop = async (index: number) => {
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...rules]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    setRules(reordered)
    setDragIndex(null)
    setDragOverIndex(null)
    await api('/api/rules/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids: reordered.map((r: any) => r.id) }),
    })
    loadRules()
  }

  const moveRule = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= rules.length) return
    const reordered = [...rules]
    const temp = reordered[index]
    reordered[index] = reordered[newIndex]
    reordered[newIndex] = temp
    // 乐观更新本地状态
    setRules(reordered)
    // 发送新顺序到后端
    await api('/api/rules/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids: reordered.map((r: any) => r.id) }),
    })
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

  // 查找 condition 的显示标签
  const findLabel = (type: string) => {
    for (const group of CONDITION_TYPES) {
      const found = group.items.find(it => it.value === type)
      if (found) return found.label
    }
    return type
  }

  // 获取某条规则的搜索文本
  const getRuleSearchText = useCallback((rule: any, col: string): string => {
    const conds = rule.conditions || []
    switch (col) {
      case 'type': {
        // 搜索匹配字段类型
        const typeParts: string[] = []
        for (const c of conds) {
          const label = findLabel(c.type || '')
          typeParts.push(`${c.type} ${label}`)
        }
        if (typeParts.length === 0 && rule.type) {
          const label = findLabel(rule.type)
          typeParts.push(`${rule.type} ${label}`)
        }
        return typeParts.join(' ')
      }
      case 'value': {
        // 搜索匹配值
        const valueParts: string[] = []
        for (const c of conds) {
          valueParts.push((c.values || []).join(' '))
        }
        if (valueParts.length === 0 && rule.value) {
          valueParts.push(rule.value)
        }
        return valueParts.join(' ')
      }
      case 'outbound': {
        // 搜索动作 + 出站
        const action = rule.action && rule.action !== 'route' ? rule.action : ''
        const outbound = rule.outbound || ''
        return `${action} ${outbound}`
      }
      case 'comment':
        return rule.comment || ''
      default:
        return ''
    }
  }, [])

  // 获取规则的所有搜索文本（用于 "所有字段" 搜索）
  const getAllRuleSearchText = useCallback((rule: any): string => {
    const parts: string[] = []
    for (const sc of SEARCH_COLUMNS) {
      if (sc.key === 'all') continue
      parts.push(getRuleSearchText(rule, sc.key))
    }
    return parts.join(' ')
  }, [getRuleSearchText])

  // 过滤后的规则列表
  const filteredRules = useMemo(() => {
    if (!searchText.trim()) return rules

    const query = searchText.toLowerCase().trim()
    return rules.filter(rule => {
      if (searchColumn === 'all') {
        return getAllRuleSearchText(rule).toLowerCase().includes(query)
      }
      return getRuleSearchText(rule, searchColumn).toLowerCase().includes(query)
    })
  }, [rules, searchText, searchColumn, getRuleSearchText, getAllRuleSearchText])

  return (
    <div className="max-w-5xl">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">📋 规则配置</h2>
          <a
            href="https://sing-box.sagernet.org/configuration/route/rule/"
            target="_blank"
            rel="noopener"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline"
          >
            参考文档 ↗
          </a>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { resetForm(); setShowForm(!showForm) }}
            className="bg-[var(--surface)] border border-[var(--border)] px-4 py-2 rounded-lg text-sm hover:bg-[var(--surface-hover)] transition-colors"
          >
            {showForm ? '取消' : '+ 添加规则'}
          </button>
          <button
            onClick={applyRules}
            disabled={loading}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? '应用中...' : '应用规则'}
          </button>
        </div>
      </div>

      {/* ── 搜索栏 ── */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索规则..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--accent)]/60 transition-colors"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={searchColumn}
          onChange={(e) => setSearchColumn(e.target.value)}
          className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-gray-300 px-2 py-1.5 focus:outline-none focus:border-[var(--accent)]/60 transition-colors"
        >
          {SEARCH_COLUMNS.map(sc => (
            <option key={sc.key} value={sc.key}>{sc.label}</option>
          ))}
        </select>
        {searchText && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {filteredRules.length} / {rules.length} 条
          </span>
        )}
      </div>

      {/* 添加/编辑表单 */}
      {showForm && (
        <div className="bg-[var(--surface)] rounded-xl p-4 mb-4 border border-[var(--border)]">
          <h3 className="text-sm font-semibold mb-3 text-gray-300">
            {editingId ? '✏️ 编辑规则' : '➕ 新建规则'}
          </h3>

          {/* 条件类型 + 值 */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">匹配字段</label>
              <select
                value={formType}
                onChange={e => setFormType(e.target.value)}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              >
                {CONDITION_TYPES.map(group => (
                  <optgroup key={group.group} label={`── ${group.group} ──`}>
                    {group.items.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                匹配值（多个值用逗号分隔）
              </label>
              <input
                value={formValue}
                onChange={e => setFormValue(e.target.value)}
                placeholder={CONDITION_TYPES.flatMap(g => g.items).find(t => t.value === formType)?.hint || '值'}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* 动作 + 出站 + 反转 + 备注 */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">动作</label>
              <select
                value={formAction}
                onChange={e => setFormAction(e.target.value)}
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              >
                {ACTIONS.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                出站 {formAction !== 'route' && '(route 时有效)'}
              </label>
              <OutboundSelectorModal
                value={formOutbound}
                onChange={setFormOutbound}
                options={outbounds}
                disabled={formAction !== 'route'}
                onAutoSelect={() => setShowTestModal(true)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">反转匹配 (invert)</label>
              <button
                onClick={() => setFormInvert(!formInvert)}
                className={`w-12 h-8 rounded-full transition-colors relative ${
                  formInvert ? 'bg-yellow-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-7 h-7 rounded-full bg-white transition-transform ${
                    formInvert ? 'left-4' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">备注</label>
              <input
                value={formComment}
                onChange={e => setFormComment(e.target.value)}
                placeholder="可选备注"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* 表单错误提示 */}
          {formError && (
            <div className="mb-3 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <span className="text-sm text-red-400">{formError}</span>
              <button
                onClick={() => setFormError('')}
                className="ml-auto text-red-400 hover:text-red-300 text-sm"
              >
                ✕
              </button>
            </div>
          )}

          {/* 提交按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => saveRule()}
              disabled={loading || !formValue}
              className="bg-[var(--accent)] text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {editingId ? '保存修改' : '添加'}
            </button>
            <button
              onClick={() => saveAndApplyRule()}
              disabled={loading || !formValue}
              className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? '应用中...' : (editingId ? '保存并应用' : '添加并应用')}
            </button>
            {editingId && (
              <button
                onClick={() => { resetForm(); setShowForm(false) }}
                className="bg-[var(--surface)] border border-[var(--border)] px-4 py-2 rounded-lg text-sm hover:bg-[var(--surface-hover)]"
              >
                取消编辑
              </button>
            )}
          </div>
        </div>
      )}

      {/* 节点测试模态框 */}
      {showTestModal && (
        <NodeTestModal
          nodes={testableNodes}
          onSelect={(tag) => setFormOutbound(tag)}
          onClose={() => setShowTestModal(false)}
          onAdd={handleTestModalAdd}
          onAddAndApply={handleTestModalAddAndApply}
          suggestedDomain={formType.startsWith('domain') ? formValue.split(',')[0].trim() : undefined}
          editing={!!editingId}
        />
      )}

      {/* 规则列表 */}
      <div className="space-y-1.5">
        {rules.length === 0 && (
          <div className="text-gray-500 text-sm py-12 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)]">
            暂无规则，点击「+ 添加规则」创建路由规则
          </div>
        )}
        {filteredRules.length === 0 && rules.length > 0 && searchText && (
          <div className="text-gray-500 text-sm py-12 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)]">
            没有匹配 "{searchText}" 的规则
          </div>
        )}
        {filteredRules.map((rule) => {
          // 原始索引（在完整 rules 数组中的位置）
          const origIndex = rules.findIndex((r: any) => r.id === rule.id)

          // 获取条件摘要
          const conds = rule.conditions || []
          let typeLabel: string
          let valueText: string

          if (conds.length > 0) {
            typeLabel = conds.map((c: any) => {
              const short = c.type?.replace(/_/g, '-') || '?'
              return short.length > 16 ? short.slice(0, 14) + '…' : short
            }).join(' & ')
            valueText = conds.map((c: any) => (c.values || []).join(', ')).join(' / ')
          } else if (rule.type && rule.value) {
            typeLabel = findLabel(rule.type).split(' - ')[0] || rule.type
            valueText = rule.value
          } else {
            typeLabel = '(空规则)'
            valueText = ''
          }

          const actionBadge = rule.action === 'reject'
            ? 'bg-red-500/20 text-red-400'
            : rule.action === 'hijack-dns'
            ? 'bg-purple-500/20 text-purple-400'
            : rule.action === 'sniff'
            ? 'bg-blue-500/20 text-blue-400'
            : 'bg-[var(--accent)]/20 text-[var(--accent)]'

          const isDragging = dragIndex === origIndex
          const isDragOver = dragOverIndex === origIndex && dragIndex !== origIndex

          return (
            <div
              key={rule.id}
              draggable
              onDragStart={() => handleDragStart(origIndex)}
              onDragOver={(e) => handleDragOver(e, origIndex)}
              onDragEnd={handleDragEnd}
              onDrop={() => handleDrop(origIndex)}
              className={`flex items-center gap-2 bg-[var(--surface)] rounded-xl p-3 border transition-all ${
                isDragging ? 'opacity-40 scale-95' : ''
              } ${isDragOver ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)]'} ${
                !rule.enabled ? 'opacity-50' : ''
              }`}
            >
              {/* 拖拽手柄 */}
              <span className="text-gray-600 cursor-grab active:cursor-grabbing text-xs shrink-0 select-none" title="拖拽排序">
                ⋮⋮
              </span>

              <span className="text-xs text-gray-500 w-5 text-right">{origIndex + 1}</span>

              {/* 排序按钮 */}
              <div className="flex flex-col shrink-0 gap-px">
                <button
                  onClick={() => moveRule(origIndex, 'up')}
                  disabled={origIndex === 0}
                  className="text-gray-500 hover:text-gray-300 disabled:opacity-20 disabled:cursor-default transition-colors leading-none text-xs"
                  title="上移"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveRule(origIndex, 'down')}
                  disabled={origIndex === rules.length - 1}
                  className="text-gray-500 hover:text-gray-300 disabled:opacity-20 disabled:cursor-default transition-colors leading-none text-xs"
                  title="下移"
                >
                  ▼
                </button>
              </div>

              {/* 启用开关 */}
              <button
                onClick={() => toggleRule(rule)}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                  rule.enabled ? 'bg-green-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    rule.enabled ? 'left-4' : 'left-0.5'
                  }`}
                />
              </button>

              {/* invert 标记 */}
              {rule.invert && (
                <span className="text-xs text-yellow-500 shrink-0" title="反转匹配">!</span>
              )}

              {/* 条件类型 */}
              <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${actionBadge}`}>
                {typeLabel}
              </span>

              {/* 匹配值 */}
              <code className="flex-1 text-sm text-gray-300 truncate min-w-0">
                {valueText}
              </code>

              {/* 动作/出站 */}
              <span className="text-xs text-gray-500 shrink-0">
                {rule.action && rule.action !== 'route' ? rule.action : rule.outbound || '?'}
              </span>

              {/* 备注 */}
              {rule.comment && (
                <span className="text-xs text-gray-600 shrink-0 max-w-[120px] truncate">{rule.comment}</span>
              )}

              {/* 编辑 */}
              <button
                onClick={() => editRule(rule)}
                className="text-gray-500 hover:text-gray-300 text-sm shrink-0 transition-colors"
                title="编辑"
              >
                ✎
              </button>

              {/* 删除 */}
              <button
                onClick={() => deleteRule(rule.id)}
                className="text-red-500 hover:text-red-400 text-sm shrink-0 transition-colors"
                title="删除"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
