'use client'

import { useState } from 'react'

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('apiUrl') || 'http://localhost:9092' : 'http://localhost:9092'
  )

  const save = () => {
    localStorage.setItem('apiUrl', apiUrl)
    alert('已保存，刷新页面生效')
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-4">⚙️ 设置</h2>

      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
        <h3 className="font-semibold mb-2">后端 API 地址</h3>
        <div className="flex gap-2">
          <input
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={save}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
            保存
          </button>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          sing-box 配置: /home/xfy/sing-box-config.json<br />
          数据目录: ~/.hermes/singbox-dashboard/<br />
          后端端口: 9092 | 前端端口: 3000
        </div>
      </div>
    </div>
  )
}
