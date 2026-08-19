export interface Ed2kPartRequest {
  type: 'part'
  buffer: ArrayBuffer
}

export interface Ed2kFinishRequest {
  type: 'finish'
  size: number
}

export type Ed2kWorkerRequest = Ed2kFinishRequest | Ed2kPartRequest

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
    | Ed2kResultResponse
