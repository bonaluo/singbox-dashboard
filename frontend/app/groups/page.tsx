'use client'

import { useState } from 'react'
import GroupManager from '@/components/GroupManager'
import GroupRulesPanel from '@/components/GroupRulesPanel'

export default function GroupsPage() {
  const [tab, setTab] = useState<'manual' | 'rules'>('manual')

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 border-b border-[var(--border)]">
        <h2 className="text-xl font-bold pb-3">📦 出站组管理</h2>
        <div className="flex gap-1 pb-3 ml-auto">
          <button
            onClick={() => setTab('manual')}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
              tab === 'manual'
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            ✋ 手动创建
          </button>
          <button
            onClick={() => setTab('rules')}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
              tab === 'rules'
                ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            🤖 自动分组规则
          </button>
        </div>
      </div>

      {tab === 'manual' ? <GroupManager /> : <GroupRulesPanel />}
    </div>
  )
}
