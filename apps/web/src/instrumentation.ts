// Runs once when the server starts. Node-only checks live in their own file, so the edge bundle never sees them.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
