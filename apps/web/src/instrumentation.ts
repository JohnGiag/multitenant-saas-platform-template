// Runs once when the server starts. Without the secret the API sees every browser as this dashboard's own address,
// so 100 bad sign-ins per minute from one person would block everybody's: refuse to start instead.
export function register(): void {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_RUNTIME === 'nodejs' && !process.env.DASHBOARD_PROXY_SECRET) {
    throw new Error("DASHBOARD_PROXY_SECRET is required in production: the API's value, the same one (32+ characters)");
  }
}
