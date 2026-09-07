export function getServerToken(): string {
  const token = process.env.DASHBOARD_JWT
  if (!token) throw new Error('DASHBOARD_JWT not set')
  return token
}
