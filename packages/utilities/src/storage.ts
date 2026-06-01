type StorageType = 'localStorage' | 'sessionStorage'

function getStore(type: StorageType): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    const store = type === 'localStorage' ? window.localStorage : window.sessionStorage
    // Test that storage is actually accessible (can be blocked by browser)
    const testKey = '__erp_storage_test__'
    store.setItem(testKey, '1')
    store.removeItem(testKey)
    return store
  } catch {
    return null
  }
}

function createSafeStorage(type: StorageType) {
  return {
    get<T>(key: string, fallback?: T): T | null {
      const store = getStore(type)
      if (!store) return fallback ?? null
      try {
        const raw = store.getItem(key)
        if (raw === null) return fallback ?? null
        return JSON.parse(raw) as T
      } catch {
        return fallback ?? null
      }
    },

    set<T>(key: string, value: T): void {
      const store = getStore(type)
      if (!store) return
      try {
        store.setItem(key, JSON.stringify(value))
      } catch {
        // Storage full or blocked — silently fail
      }
    },

    remove(key: string): void {
      const store = getStore(type)
      if (!store) return
      try {
        store.removeItem(key)
      } catch {
        // ignore
      }
    },

    clear(): void {
      const store = getStore(type)
      if (!store) return
      try {
        store.clear()
      } catch {
        // ignore
      }
    },

    has(key: string): boolean {
      const store = getStore(type)
      if (!store) return false
      try {
        return store.getItem(key) !== null
      } catch {
        return false
      }
    },

    keys(): string[] {
      const store = getStore(type)
      if (!store) return []
      try {
        return Object.keys(store)
      } catch {
        return []
      }
    },
  }
}

export const safeLocalStorage = createSafeStorage('localStorage')
export const safeSessionStorage = createSafeStorage('sessionStorage')

// Convenience typed wrapper for namespaced keys
export function createStorageStore<T extends Record<string, unknown>>(
  namespace: string,
  type: StorageType = 'localStorage'
) {
  const storage = type === 'localStorage' ? safeLocalStorage : safeSessionStorage
  return {
    get<K extends keyof T>(key: K): T[K] | null {
      return storage.get<T[K]>(`${namespace}:${String(key)}`)
    },
    set<K extends keyof T>(key: K, value: T[K]): void {
      storage.set(`${namespace}:${String(key)}`, value)
    },
    remove<K extends keyof T>(key: K): void {
      storage.remove(`${namespace}:${String(key)}`)
    },
    clear(): void {
      const allKeys = storage.keys().filter((k) => k.startsWith(`${namespace}:`))
      allKeys.forEach((k) => storage.remove(k))
    },
  }
}
