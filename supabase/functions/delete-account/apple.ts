// Revoking Sign in with Apple when an account is deleted, as Apple asks of apps that offer it: the
// app sends a fresh authorization code, the server trades it for a token and revokes that token.
// It needs the Sign in with Apple key in the function secrets: APPLE_TEAM_ID, APPLE_KEY_ID and
// APPLE_PRIVATE_KEY (the text of the .p8 file); APPLE_CLIENT_ID defaults to the bundle id. Plain
// TypeScript that Deno (the Edge Function) and Node (the smoke test) both run.

export interface AppleKey {
  teamId: string;
  keyId: string;
  /** The .p8 file: a PKCS #8 P-256 private key in PEM. */
  privateKey: string;
  clientId: string;
}

const APPLE = 'https://appleid.apple.com';

export function appleKeyFrom(env: (name: string) => string | undefined): AppleKey | null {
  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const privateKey = env('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId: env('APPLE_CLIENT_ID') ?? 'app.gozali' };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The client secret Apple's token endpoints want: a JWT signed with the key, valid 5 minutes. */
export async function appleClientSecret(key: AppleKey, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const unsigned = `${encodeJson({ alg: 'ES256', kid: key.keyId })}.${encodeJson({
    iss: key.teamId,
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: APPLE,
    sub: key.clientId,
  })}`;
  const der = Uint8Array.from(atob(key.privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (char) =>
    char.charCodeAt(0),
  );
  const signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto signs ECDSA as r and s side by side, which is the form a JWT uses.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

type Send = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<Response>;

/** Trades the code for a token and revokes it. Returns 'revoked', or where it stopped. */
export async function revokeAppleSignIn(key: AppleKey, code: string, send: Send = fetch): Promise<string> {
  const secret = await appleClientSecret(key);
  const post = (path: string, fields: Record<string, string>) =>
    send(`${APPLE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: key.clientId, client_secret: secret, ...fields }).toString(),
    });
  const exchange = await post('/auth/token', { code, grant_type: 'authorization_code' });
  if (!exchange.ok) return `token ${exchange.status}`;
  const tokens = (await exchange.json()) as { refresh_token?: string; access_token?: string };
  const [token, hint] = tokens.refresh_token ? [tokens.refresh_token, 'refresh_token'] : [tokens.access_token, 'access_token'];
  if (!token) return 'no token';
  const revoke = await post('/auth/revoke', { token, token_type_hint: hint });
  return revoke.ok ? 'revoked' : `revoke ${revoke.status}`;
}
