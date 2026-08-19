export type RequestOptions = RequestInit & {
  responseType?:
    | 'text'
    | 'json'
    | 'arraybuffer'
    | 'blob'
    | 'document'
    | 'stream'
  timeout?: number
  params?: unknown
  cache?: 'force-cache' | 'no-cache'
  cacheTime?: number
  cacheKey?: string
  cacheStatus?: number[]
  data?: unknown
  /** Tampermonkey: merge this value into the browser cookie set. */
  cookie?: string
  /** Tampermonkey: select the partitioned cookie jar used by the request. */
  cookiePartition?: {
    topLevelSite?: string
  }
  /** Receive byte-level download progress from request implementations that support it. */
  onProgress?: (progress: RequestProgress) => void
  /** Reject a response as soon as its status and headers become available. */
  validateResponse?: (response: RequestResponseHead) => void
  /** Abort a response that exceeds the caller's bounded-memory contract. */
  maxResponseBytes?: number
}

export interface RequestProgress {
  lengthComputable: boolean
  loaded: number
  total: number
}

export interface RequestResponseHead {
  headers: Headers
  status: number
  statusText: string
}

export type ResponseType = Response

/** 响应缓存接口 */
export interface IRequestCache {
  get: (url: string, options?: RequestOptions) => Promise<Response | null>
  set: (url: string, response: Response, options?: RequestOptions) => Promise<void>
  remove: (url: string, options?: RequestOptions) => Promise<void>
  clear: () => Promise<void>
}

/** 请求接口 */
export interface IRequest {
  get: (url: string, options?: RequestOptions) => Promise<ResponseType>
  post: (url: string, options?: RequestOptions) => Promise<ResponseType>
  request: (
    url: string,
    options?: RequestOptions,
  ) => Promise<ResponseType>
}
