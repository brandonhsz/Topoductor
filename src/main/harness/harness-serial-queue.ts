/** Serializes read-modify-write of one file so two writers never drop each other's change. */
export function createHarnessSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.catch(() => {})
    return next
  }
}
