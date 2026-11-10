import api from '../api/index'

export async function downloadFile(url: string, fileName: string) {
  const res = await api.get(url, { responseType: 'blob', timeout: 120000 })
  saveBlob(res.data, fileName)
}

export function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = fileName || 'download'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

export async function apiErrorMessage(err: any, fallback = '下载失败'): Promise<string> {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      return parsed?.error?.message || parsed?.message || fallback
    } catch {
      return fallback
    }
  }
  return data?.error?.message || data?.message || err?.message || fallback
}
