import { Lead } from '../domain/db-types.js'

export const leadRepo = {
  async isDuplicate(organizationId: string, email: string): Promise<boolean> {
    // TODO: implement
    return false
  }
}
