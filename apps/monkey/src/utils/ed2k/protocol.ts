export interface Ed2kPartRequest {
  type: 'part'
  buffer: ArrayBuffer
}

export interface Ed2kPingRequest {
  type: 'ping'
}

export interface Ed2kFinishRequest {
  type: 'finish'
  size: number
}

export type Ed2kWorkerRequest
  = | Ed2kFinishRequest
    | Ed2kPartRequest
    | Ed2kPingRequest

export interface Ed2kReadyResponse {
  type: 'ready'
}

export interface Ed2kPartResponse {
  type: 'part'
  hash: string
}

export interface Ed2kResultResponse {
  type: 'result'
  hash: string
}

export interface Ed2kErrorResponse {
  type: 'error'
  message: string
}

export type Ed2kWorkerResponse
  = | Ed2kErrorResponse
    | Ed2kPartResponse
    | Ed2kReadyResponse
    | Ed2kResultResponse
