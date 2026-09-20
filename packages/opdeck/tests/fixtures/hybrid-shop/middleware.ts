export { default } from 'next-auth/middleware'

export const config = {
  matcher: ['/api/reports/:path*', '/api/admin/:path*'],
}
