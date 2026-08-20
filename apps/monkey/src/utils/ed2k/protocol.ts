export interface Ed2kBatchRequest {
  type: 'batch'
  buffer: ArrayBuffer
}

export interface Ed2kPingRequest {
  type: 'ping'
}

export type Ed2kWorkerRequest
  = | Ed2kBatchRequest
    | Ed2kPingRequest

export interface Ed2kReadyResponse {
  type: 'ready'
}

export interface Ed2kBatchResponse {
  type: 'batch'
  hashes: string[]
}

export interface Ed2kErrorResponse {
  type: 'error'
  message: string
}

export type Ed2kWorkerResponse
  = | Ed2kBatchResponse
    | Ed2kErrorResponse
    | Ed2kReadyResponse
