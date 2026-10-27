// Every value is treated as secret. Long values keep their last 4 characters so admins can tell keys apart.
export function maskConfig(config: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).map(([name, value]) => [name, value.length >= 16 ? `****${value.slice(-4)}` : '****']),
  );
}
