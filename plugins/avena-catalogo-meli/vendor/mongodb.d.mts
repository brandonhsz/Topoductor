// The slice of the bundled driver (mongodb.mjs) the worker uses.
export declare class MongoClient {
  constructor(uri: string, options?: Record<string, unknown>)
  connect(): Promise<this>
  close(): Promise<void>
  db(name: string): {
    collection<T>(name: string): {
      find(query: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<T[]> }
    }
  }
}
