'use client'

import { useState, useEffect } from 'react'
import { api } from '@/components/Sidebar'

interface GroupMember {
  tag: string
  type: string
  region?: string
  is_group: boolean
  member_count?: number
}

interface GroupInfo {
  name: string
  type: string
  nodes: string[]
  now?: string
}

export default function GroupManager() {
  const [proxyMembers, setProxyMembers] = useState<GroupMember[]>([])
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [checkedNodes, setCheckedNodes] = useState<Set<string>>(new Set())
  const [checkedGroups, setCheckedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    const [mRes, gRes] = await Promise.all([
      api('/api/groups/members'),
      api('/api/groups'),
    ])
    if (mRes.ok) {
      setProxyMembers(mRes.data.proxies || [])
      setGroupMembers(mRes.data.groups || [])
    }
    if (gRes.ok) setGroups(gRes.data.groups || [])
  }

  useEffect(() => { loadData() }, [])

  const toggleNode = (tag: string) => {
    setCheckedNodes(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const toggleGroup = (tag: string) => {
    setCheckedGroups(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const selectAllNodes = () => {
    setCheckedNodes(new Set(proxyMembers.map(n => n.tag)))
  }

  const deselectAll = () => {
    setCheckedNodes(new Set())
    setCheckedGroups(new Set())
  }

  const totalSelected = checkedNodes.size + checkedGroups.size

  const createGroup = async () => {
    if (!groupName || totalSelected === 0) return
    setLoading(true)
    await api('/api/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: groupName,
        nodes: [...Array.from(checkedNodes), ...Array.from(checkedGroups)],
      }),
    })
    setGroupName('')
    setCheckedNodes(new Set())
    setCheckedGroups(new Set())
    setShowCreate(false)
    setLoading(false)
    loadData()
  }

  const deleteGroup = async (name: string) => {
    await api(`/api/groups/${encodeURIComponent(name)}`, { method: 'DELETE' })
    loadData()
  }

  // 按地区分组展示节点
  const nodesByRegion: Record<string, GroupMember[]> = {}
  for (const n of proxyMembers) {
    const region = n.region || '其他'
    if (!nodesByRegion[region]) nodesByRegion[region] = []
    nodesByRegion[region].push(n)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">📦 出站组管理</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 transition-opacity"
        >
          {showCreate ? '取消' : '+ 创建出站组'}
        </button>
      </div>

      {/* 创建出站组表单 */}
      {showCreate && (
        <div className="bg-[var(--surface)] rounded-xl p-4 mb-4 border border-[var(--border)]">
          <div className="flex items-end gap-3 mb-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">组名称</label>
              <input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="例如: 香港节点组"
                className="w-full bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={selectAllNodes}
                className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 border border-[var(--border)] rounded-lg transition-colors"
              >
                全选节点
              </button>
              <button
                onClick={deselectAll}
                className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 border border-[var(--border)] rounded-lg transition-colors"
              >
                清空
              </button>
            </div>
          </div>

          {/* 可选已有组 */}
          {groupMembers.length > 0 && (
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-2 block">
                已有出站组（可嵌套，已选 {checkedGroups.size} 个）
              </label>
              <div className="flex flex-wrap gap-1.5">
                {groupMembers.map(g => (
                  <button
                    key={g.tag}
                    onClick={() => toggleGroup(g.tag)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm border transition-colors text-left ${
                      checkedGroups.has(g.tag)
                        ? 'border-blue-400 bg-blue-500/10'
                        : 'border-[var(--border)] hover:border-gray-600'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                      checkedGroups.has(g.tag)
                        ? 'bg-blue-400 border-blue-400 text-white'
                        : 'border-gray-500'
                    }`}>
                      {checkedGroups.has(g.tag) ? '✓' : ''}
                    </span>
                    <span className={`text-[10px] px-1 py-0.5 rounded font-mono ${
                      g.type === 'urltest' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {g.type === 'urltest' ? 'URL' : 'SEL'}
                    </span>
                    <span className="truncate">{g.tag}</span>
                    {g.member_count !== undefined && (
                      <span className="text-xs text-gray-500">({g.member_count})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 单个节点选择 */}
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-2 block">
              选择节点（共 {proxyMembers.length} 个，已选 {checkedNodes.size} 个）
            </label>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {Object.entries(nodesByRegion).map(([region, regionNodes]) => (
                <div key={region}>
                  <div className="text-xs text-gray-500 mb-1.5 font-medium sticky top-0 bg-[var(--surface)] py-1">
                    {region} ({regionNodes.length})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {regionNodes.map(n => (
                      <button
                        key={n.tag}
                        onClick={() => toggleNode(n.tag)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm border transition-colors text-left ${
                          checkedNodes.has(n.tag)
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] hover:border-gray-600'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
                          checkedNodes.has(n.tag)
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                            : 'border-gray-500'
                        }`}>
                          {checkedNodes.has(n.tag) ? '✓' : ''}
                        </span>
                        <span className="truncate">{n.tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={createGroup}
            disabled={loading || !groupName || totalSelected === 0}
            className="bg-[var(--accent)] text-white px-6 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? '创建中...' : `创建组 (${totalSelected} 项)`}
          </button>
        </div>
      )}

      {/* 已存在的组列表 */}
      <div className="space-y-2">
        {groups.length === 0 && (
          <div className="text-gray-500 text-sm py-12 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)]">
            暂无出站组，点击「+ 创建出站组」新建
          </div>
        )}
        {groups.map(g => (
          <div
            key={g.name}
            className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  g.type === 'urltest' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {g.type === 'urltest' ? 'URL' : 'SEL'}
                </span>
                <span className="font-medium text-sm">{g.name}</span>
                {g.now && (
                  <span className="text-xs text-gray-500">当前: {g.now}</span>
                )}
              </div>
              <button
                onClick={() => deleteGroup(g.name)}
                className="text-red-500 hover:text-red-400 text-sm transition-colors"
                title="删除组"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.nodes.map(n => (
                <span
                  key={n}
                  className={`text-[11px] px-1.5 py-0.5 rounded ${
                    n === g.now ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
