import type { ReadImage } from './images'

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
    const tx = db.transaction('crops', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
    const request = act(tx.objectStore('crops'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
}

type StoredCrop = Omit<ReadImage, 'src'>

export const draftCrop = {
  read: async (id: string): Promise<ReadImage | null> => {
    const crop = await access<StoredCrop | undefined>('readonly', (store) => store.get(id))
    return crop === undefined ? null : { ...crop, src: `data:${crop.mediaType};base64,${crop.data}` }
  },
  write: (id: string, { src: _src, ...crop }: ReadImage) => access('readwrite', (store) => store.put(crop, id)),
  remove: (id: string) => access('readwrite', (store) => store.delete(id)),
}
