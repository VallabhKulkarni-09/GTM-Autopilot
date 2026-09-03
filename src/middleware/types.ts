/**
 * types.ts
 * Extends FastifyRequest with tenantContext.
 * Import this file to get type augmentation on request.tenantContext.
 */

import type { FastifyRequest } from 'fastify'

export type TenantContext = {
  organizationId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: TenantContext
  }
}
