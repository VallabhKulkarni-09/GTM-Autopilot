/**
 * apollo.errors.ts
 * Error codes for the Apollo connector.
 * Prefix: AP_
 * All codes are SCREAMING_SNAKE_CASE as required by ConnectorError.
 */

export const ApolloErrorCode = {
  // Auth
  AUTH_FAILED:           'AP_AUTH_FAILED',
  // Enrichment
  ENRICH_FAILED:         'AP_ENRICH_FAILED',
  // Config
  NOT_CONNECTED:         'AP_NOT_CONNECTED',
  // Network
  NETWORK_ERROR:         'AP_NETWORK_ERROR',
} as const

export type ApolloErrorCode = typeof ApolloErrorCode[keyof typeof ApolloErrorCode]
