const bucket = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const current = bucket.get(key);

  if (!current || now > current.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (current.count >= limitPerMinute) return false;
  current.count += 1;
  return true;
}
