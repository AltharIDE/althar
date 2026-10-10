/** Public, pinned weights; only model files are downloaded. Evidence never leaves this process. */
export const MEMORY_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const MEMORY_MODEL_REVISION = 'cb3d680149bf9a3209564e1b27ab3bb355b65707'
export type EmbedMemory = (texts: ReadonlyArray<string>) => Promise<ReadonlyArray<ReadonlyArray<number>>>

/** Lazily initialize once. A failed download can retry; concurrent callers share initialization. */
export const memoryEmbeddings = (cacheDir: string): EmbedMemory => {
  let loading: Promise<EmbedMemory> | undefined
  return async (texts) => {
    loading ??= (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const model = await pipeline('feature-extraction', MEMORY_MODEL, {
        revision: MEMORY_MODEL_REVISION,
        dtype: 'q8',
        device: 'cpu',
        cache_dir: cacheDir,
      })
      return async (values: ReadonlyArray<string>) => {
        const result: number[][] = []
        // Bound native inference work and temporary tensors even during backlog catch-up.
        for (let offset = 0; offset < values.length; offset += 16) {
          const batch = await model(values.slice(offset, offset + 16), { pooling: 'mean', normalize: true })
          result.push(...(batch.tolist() as number[][]))
        }
        return result
      }
    })().catch((error: unknown) => {
      loading = undefined
      throw error
    })
    return (await loading)(texts)
  }
}
