export interface DraftItem {
  categoryId: string
  amount: number
  expenseDate: string
  description: string
}

export interface DraftFields {
  version: 1
  title: string
  description: string
  aiTab: string
  items: DraftItem[]
  updatedAt: number
}

export const NEW_EXPENSE_DRAFT_KEY = 'sse:expense-draft:new'

const DB_NAME = 'sse-drafts'
const DB_VERSION = 1
const FILE_STORE = 'files'
const FILE_RECORD_KEY = 'new'

export function hasDraftContent(
  fields: { title?: string; description?: string; items?: DraftItem[] } | null | undefined,
): boolean {
  if (!fields) return false
  if ((fields.title || '').trim()) return true
  if ((fields.description || '').trim()) return true
  return (fields.items || []).some(item =>
    !!item.categoryId
    || Number(item.amount) > 0
    || !!(item.description || '').trim(),
  )
}

export function loadDraftFields(): DraftFields | null {
  try {
    const raw = localStorage.getItem(NEW_EXPENSE_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return null
    return {
      version: 1,
      title: String(parsed.title || ''),
      description: String(parsed.description || ''),
      aiTab: String(parsed.aiTab || 'text'),
      items: parsed.items.map((item: any) => ({
        categoryId: String(item?.categoryId || ''),
        amount: Number(item?.amount) || 0,
        expenseDate: String(item?.expenseDate || ''),
        description: String(item?.description || ''),
      })),
      updatedAt: Number(parsed.updatedAt) || 0,
    }
  } catch {
    return null
  }
}

export function saveDraftFields(fields: DraftFields): void {
  try {
    localStorage.setItem(NEW_EXPENSE_DRAFT_KEY, JSON.stringify(fields))
  } catch { /* storage may be unavailable */ }
}

export function clearDraftFields(): void {
  try {
    localStorage.removeItem(NEW_EXPENSE_DRAFT_KEY)
  } catch { /* ignore */ }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveDraftFiles(files: Array<File | null | undefined>): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(FILE_STORE, 'readwrite')
      tx.objectStore(FILE_STORE).put(files.map(file => file || null), FILE_RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}

export async function loadDraftFiles(): Promise<Array<File | null>> {
  const db = await openDb()
  if (!db) return []
  const files = await new Promise<Array<File | null>>((resolve) => {
    try {
      const tx = db.transaction(FILE_STORE, 'readonly')
      const request = tx.objectStore(FILE_STORE).get(FILE_RECORD_KEY)
      request.onsuccess = () => {
        const value = request.result
        resolve(Array.isArray(value) ? value.map((file: any) => (file instanceof Blob ? file as File : null)) : [])
      }
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
  db.close()
  return files
}

export async function clearDraftFiles(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(FILE_STORE, 'readwrite')
      tx.objectStore(FILE_STORE).delete(FILE_RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}
