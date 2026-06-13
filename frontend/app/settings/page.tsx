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
  const [ruleSets, setRuleSets] = useState<{tag: string; size: number; ok: boolean}[]>([])
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')

  useEffect(() => {
    api('/api/settings/geo-update').then(r => {
      if (r.ok) {
        setGeoInterval(r.data.interval || 'off')
        setGeoLastUpdated(r.data.last_updated || '')
        setRuleSets(r.data.rule_sets || [])
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
      // 延迟刷新 rule-set 状态（下载是异步的）
      if (geoInterval !== 'off') {
        setTimeout(async () => {
          const r2 = await api('/api/settings/geo-update')
          if (r2.ok) setRuleSets(r2.data.rule_sets || [])
        }, 3000)
      } else {
        setRuleSets([])
      }
    } else {
      setGeoMsg(r.error || '保存失败')
    }
    setSavingGeo(false)
  }

  const handleExport = async () => {
    setExporting(true)
    setBackupMsg('')
    try {
      const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
      const resp = await fetch(`${baseUrl}/api/backup/export`)
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: '导出失败' }))
        setBackupMsg('导出失败: ' + (err.error || resp.statusText))
        return
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // 从 Content-Disposition 解析文件名
      const disposition = resp.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?(.+?)"?$/)
      a.download = match ? match[1] : 'singbox-backup.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setBackupMsg('备份已下载')
    } catch (e: any) {
      setBackupMsg('导出失败: ' + (e.message || '网络错误'))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setBackupMsg('')
    try {
      const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
      const resp = await fetch(`${baseUrl}/api/backup/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      })
      const result = await resp.json()
      if (result.ok) {
        setBackupMsg(result.data.msg + ' — ' + result.data.summary)
      } else {
        setBackupMsg('导入失败: ' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      setBackupMsg('导入失败: ' + (e.message || '网络错误'))
    } finally {
      setImporting(false)
      // 清除文件选择，允许重复选择同一文件
      e.target.value = ''
    }
  }

  const intervalLabels: Record<string, string> = {
    off: '关闭',
    '1d': '每天',
    '7d': '每周',
    '30d': '每月',
  }

  // ── Config Viewer ──
  const [configOpen, setConfigOpen] = useState(false)
  const [config, setConfig] = useState<any>(null)
  const [configCollapsed, setConfigCollapsed] = useState<Set<string>>(new Set())
  const [configCopied, setConfigCopied] = useState(false)

  const loadConfig = async () => {
    const r = await api('/api/config')
    if (r.ok) setConfig(r.data)
  }

  const copyConfig = () => {
    if (!config) return
    const text = JSON.stringify(config, null, 2)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setConfigCopied(true)
        setTimeout(() => setConfigCopied(false), 2000)
      }).catch(() => fallbackCopyConfig(text))
    } else {
      fallbackCopyConfig(text)
    }
  }

  const fallbackCopyConfig = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand('copy')
      setConfigCopied(true)
      setTimeout(() => setConfigCopied(false), 2000)
    } catch {
      // 静默失败
    } finally {
      document.body.removeChild(ta)
    }
  }

  const ConfigTree = ({ data, path = '' }: { data: any; path?: string }) => {
    if (data === null || data === undefined) return <span className="text-gray-500">null</span>
    if (typeof data === 'string') return <span className="text-green-400/80">"{data}"</span>
    if (typeof data === 'number' || typeof data === 'boolean') return <span className="text-yellow-400">{String(data)}</span>
    if (Array.isArray(data)) {
      if (data.length === 0) return <span className="text-gray-500">[]</span>
      const key = path || 'root'
      const collapsed = configCollapsed.has(key)
      return (
        <div className="ml-3">
          <button onClick={() => setConfigCollapsed(prev => { const n = new Set(prev); collapsed ? n.delete(key) : n.add(key); return n })}
            className="text-xs text-gray-500 hover:text-gray-300 mb-0.5">
            {collapsed ? '▶' : '▼'} [{data.length}]
          </button>
          {!collapsed && data.map((item: any, i: number) => (
            <div key={i} className="ml-2 border-l border-[var(--border)]/30 pl-2">
              <span className="text-xs text-gray-600 mr-1">{i}:</span>
              <ConfigTree data={item} path={`${path}[${i}]`} />
            </div>
          ))}
        </div>
      )
    }
    if (typeof data === 'object') {
      const entries = Object.entries(data)
      if (entries.length === 0) return <span className="text-gray-500">{'{}'}</span>
      const key = path || 'root'
      const collapsed = configCollapsed.has(key)
      return (
        <div className="ml-3">
          <button onClick={() => setConfigCollapsed(prev => { const n = new Set(prev); collapsed ? n.delete(key) : n.add(key); return n })}
            className="text-xs text-gray-500 hover:text-gray-300 mb-0.5">
            {collapsed ? '▶' : '▼'} {'{...}'}
          </button>
          {!collapsed && entries.map(([k, v]) => (
            <div key={k} className="ml-2">
              <span className="text-[var(--accent)] text-xs">{k}: </span>
              <ConfigTree data={v} path={`${path}.${k}`} />
            </div>
          ))}
        </div>
      )
    }
    return <span>{JSON.stringify(data)}</span>
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
        {ruleSets.length > 0 && (
          <div className="mt-3 space-y-1">
            {ruleSets.map(rs => (
              <div key={rs.tag} className="flex items-center gap-2 text-xs">
                <span className={rs.ok ? 'text-green-400' : 'text-red-400'}>
                  {rs.ok ? '✓' : '✗'}
                </span>
                <span className="text-gray-300 font-mono">{rs.tag}</span>
                <span className="text-gray-500">
                  {rs.ok ? `${(rs.size / 1024).toFixed(1)} KB` : '未下载'}
                </span>
              </div>
            ))}
          </div>
        )}
        {geoMsg && (
          <p className={`text-xs mt-2 ${geoMsg.includes('失败') ? 'text-red-400' : 'text-green-400'}`}>
            {geoMsg}
          </p>
        )}
      </div>

      {/* ── 备份与还原 ── */}
      <div className="bg-[var(--surface)] rounded-xl p-4 mt-4 border border-[var(--border)]">
        <h3 className="font-semibold mb-2">💾 备份与还原</h3>
        <p className="text-xs text-gray-500 mb-3">
          导出所有配置（订阅、规则、分组规则、sing-box 配置等）到备份文件，或从备份文件还原。
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={handleExport}
            disabled={exporting}
            className="bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50">
            {exporting ? '导出中...' : '📥 导出备份'}
          </button>
          <label className="bg-[#0f1419] border border-[var(--border)] text-[var(--foreground)] px-4 py-2 rounded-lg text-sm cursor-pointer hover:border-[var(--accent)] transition-colors">
            {importing ? '导入中...' : '📤 导入备份'}
            <input type="file" accept=".json" onChange={handleImport}
              disabled={importing}
              className="hidden" />
          </label>
        </div>
        {backupMsg && (
          <p className={`text-xs mt-2 ${backupMsg.includes('失败') ? 'text-red-400' : 'text-green-400'}`}>
            {backupMsg}
          </p>
        )}
      </div>

      {/* 查看配置 */}
      <div className="bg-[var(--surface)] rounded-xl p-4 mt-4 border border-[var(--border)]">
        <button
          onClick={() => { setConfigOpen(!configOpen); if (!config && !configOpen) loadConfig() }}
          className="flex items-center justify-between w-full"
        >
          <h3 className="font-semibold">📄 sing-box 配置</h3>
          <div className="flex items-center gap-2">
            {configOpen && config && (
              <button
                onClick={e => { e.stopPropagation(); copyConfig() }}
                className="bg-[var(--accent)] text-white px-2.5 py-1 rounded text-xs hover:opacity-80"
              >
                {configCopied ? '已复制 ✓' : '复制'}
              </button>
            )}
            <span className="text-gray-500 text-sm">{configOpen ? '收起' : '展开'}</span>
          </div>
        </button>
        {configOpen && config && (
          <div className="mt-3 bg-[#0f1419] rounded-lg p-3 text-xs font-mono max-h-[500px] overflow-auto">
            <ConfigTree data={config} />
          </div>
        )}
        {configOpen && !config && (
          <div className="mt-3 text-xs text-gray-500">加载中...</div>
        )}
      </div>
    </div>
  )
}
