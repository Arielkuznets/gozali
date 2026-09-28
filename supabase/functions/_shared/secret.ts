// The shared secret pg_cron and the report trigger send in x-cron-secret.

/**
 * True when the request carries CRON_SECRET. The comparison takes the same time however much of
 * a wrong secret matches, so response times give nothing away.
 */
export function hasCronSecret(request: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET');
  const given = request.headers.get('x-cron-secret');
  if (!secret || !given) return false;
  const expected = new TextEncoder().encode(secret);
  const actual = new TextEncoder().encode(given);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index]! ^ actual[index]!;
  return difference === 0;
}
