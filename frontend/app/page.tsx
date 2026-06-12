'use client'

import { useSSE } from '@/hooks/useSSE'

export default function HomePage() {
  const { status } = useSSE(['status'])

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold mb-6">🏠 仪表盘</h2>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="服务状态" value={status?.running ? '运行中 ✅' : '已停止 ❌'} />
        <StatCard label="代理节点" value={`${status?.total_nodes || 0} 个`} />
        <StatCard label="当前节点" value={status?.current || '-'} small />
      </div>

      {status?.current && (
        <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
          <h3 className="font-semibold mb-2">当前节点详情</h3>
          <div className="text-sm text-gray-300">{status.current}</div>
          {status.uptime && <div className="text-xs text-gray-500 mt-2">启动时间: {status.uptime}</div>}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`font-bold ${small ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  )
}
