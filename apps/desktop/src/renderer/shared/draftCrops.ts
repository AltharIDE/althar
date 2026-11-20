/*
 * Unsent page crops belong to the window's profile, alongside its draft
 * facts. Each capture has its own key so replacing or removing one never
 * changes a crop another comment is waiting to send.
 */
let opened: Promise<IDBDatabase> | undefined

const database = () => {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('althar.draft-crops', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('crops')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return opened
}

const access = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('crops', mode)
    const request = act(tx.objectStore('crops'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
}

export const draftCrop = {
  read: async (id: string): Promise<string | null> => {
    const data: unknown = await access('readonly', (store) => store.get(id))
    return typeof data === 'string' ? data : null
  },
  write: (id: string, data: string) => access('readwrite', (store) => store.put(data, id)),
  remove: (id: string) => access('readwrite', (store) => store.delete(id)),
}
