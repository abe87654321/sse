const AUTH_ENDPOINTS = ['/auth/login', '/auth/api-key-login', '/auth/refresh']

/**
 * A 401 from a normal API means the access token is no longer valid and the
 * user needs to re-authenticate. Auth endpoints are excluded so a wrong
 * password is not reported as an expired session.
 */
export function shouldMarkSessionExpired(status: number | undefined, url: string | undefined): boolean {
  if (status !== 401) return false
  const path = url || ''
  return !AUTH_ENDPOINTS.some(endpoint => path.includes(endpoint))
}
