import { Integration } from '../../entity/integration'
import { Page } from '../../elastic/types'

export type RetrievedDataState = 'archived' | 'saved' | 'deleted'
export interface RetrievedData {
  url: string
  labels?: string[]
  state?: RetrievedDataState
}
export interface RetrievedResult {
  data: RetrievedData[]
  hasMore?: boolean
  since?: number
}

export interface RetrieveRequest {
  token: string
  since?: number
  count?: number
  offset?: number
}

export abstract class IntegrationService {
  abstract name: string

  accessToken = async (token: string): Promise<string | null> => {
    return Promise.resolve(null)
  }
  export = async (
    integration: Integration,
    pages: Page[]
  ): Promise<boolean> => {
    return Promise.resolve(false)
  }
  retrieve = async (req: RetrieveRequest): Promise<RetrievedResult> => {
    return Promise.resolve({ data: [] })
  }
}
