'use client'

/**
 * 获取后端 API 基础地址。
 * 优先级：
 * 1. localStorage 中用户手动设置的 apiUrl
 * 2. 从浏览器当前域名自动推导（同协议+主机名，端口 +92）
 *    例如: http://asus-dev.local:9001 → http://asus-dev.local:9093
 *          http://asus-dev.local:9000 → http://asus-dev.local:9092
 * 3. 构建时环境变量 NEXT_PUBLIC_API
 * 4. 硬编码默认值
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('apiUrl')
    if (stored) return stored

    const loc = window.location
    const frontendPort = loc.port ? parseInt(loc.port, 10) : 0
    const backendPort = frontendPort
      ? frontendPort + 92
      : parseFallbackPort()
    return `${loc.protocol}//${loc.hostname}:${backendPort}`
  }
  return process.env.NEXT_PUBLIC_API || 'http://localhost:9092'
}

/** 从构建时环境变量提取后端端口，作为无前端端口时的兜底 */
function parseFallbackPort(): number {
  const fallback = process.env.NEXT_PUBLIC_API || 'http://localhost:9092'
  try {
    const p = parseInt(new URL(fallback).port, 10)
    return p || 9092
  } catch {
    return 9092
  }
}

export function api(endpoint: string, options?: RequestInit) {
  const base = getApiUrl()
  return fetch(`${base}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(r => r.json())
}
