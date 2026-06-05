'use client'

import { useState, useEffect } from 'react'
import { api } from '@/components/Sidebar'

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('apiUrl') || 'http://localhost:9092' : 'http://localhost:9092'
  )
  const [geoInterval, setGeoInterval] = useState('off')
  const [geoLastUpdated, setGeoLastUpdated] = useState('')
  const [savingGeo, setSavingGeo] = useState(false)
  const [geoMsg, setGeoMsg] = useState('')

  useEffect(() => {
    api('/api/settings/geo-update').then(r => {
      if (r.ok) {
        setGeoInterval(r.data.interval || 'off')
        setGeoLastUpdated(r.data.last_updated || '')
      }
    })
  }, [])

  const saveApiUrl = () => {
    localStorage.setItem('apiUrl', apiUrl)
    alert('已保存，刷新页面生效')
  }

  const saveGeoInterval = async () => {
    setSavingGeo(true)
    setGeoMsg('')
    const r = await api('/api/settings/geo-update', {
      method: 'POST',
      body: JSON.stringify({ interval: geoInterval }),
    })
    if (r.ok) {
      setGeoInterval(r.data.interval)
      setGeoLastUpdated(r.data.last_updated || '')
      setGeoMsg(geoInterval === 'off' ? '已关闭自动更新' : '已保存，将立即开始更新')
    } else {
      setGeoMsg(r.error || '保存失败')
    }
    setSavingGeo(false)
  }

  const intervalLabels: Record<string, string> = {
    off: '关闭',
    '1d': '每天',
    '7d': '每周',
    '30d': '每月',
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold mb-4">⚙️ 设置</h2>

      <div className="bg-[var(--surface)] rounded-xl p-4 mb-4 border border-[var(--border)]">
        <h3 className="font-semibold mb-2">后端 API 地址</h3>
        <div className="flex gap-2">
          <input
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            className="flex-1 bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={saveApiUrl}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
            保存
          </button>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]">
        <h3 className="font-semibold mb-2">🌐 Geo 规则集自动更新</h3>
        <p className="text-xs text-gray-500 mb-3">
          geoip-cn / geosite-cn 用于国内流量直连规则。定期更新可保持 IP 段和域名列表的时效性。
        </p>
        <div className="flex gap-2 items-center">
          <select
            value={geoInterval}
            onChange={e => setGeoInterval(e.target.value)}
            className="bg-[#0f1419] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          >
            <option value="off">关闭</option>
            <option value="1d">每天</option>
            <option value="7d">每周</option>
            <option value="30d">每月</option>
          </select>
          <button onClick={saveGeoInterval} disabled={savingGeo}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {savingGeo ? '保存中...' : '保存'}
          </button>
        </div>
        {geoLastUpdated && (
          <p className="text-xs text-gray-500 mt-2">上次更新: {geoLastUpdated}</p>
        )}
        {geoMsg && (
          <p className={`text-xs mt-2 ${geoMsg.includes('失败') ? 'text-red-400' : 'text-green-400'}`}>
            {geoMsg}
          </p>
        )}
      </div>
    </div>
  )
}
