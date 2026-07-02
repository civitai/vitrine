import { exchangeCode, OAuthError } from '@civitai/app-sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { recordEvent } from '@/lib/analytics.server';
import { env, REDIRECT_URI } from '@/lib/env';
import { consumeOAuthState, setSession } from '@/lib/session';
import { getUserKey } from '@/lib/userKey';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const expected = await consumeOAuthState();

  if (error) return redirectHome(`oauth_error:${error}`);
  if (!code || !state) return redirectHome('missing_code_or_state');
  if (!expected || expected.state !== state) return redirectHome('state_mismatch');

  try {
    const tokens = await exchangeCode({
      baseUrl: env.NEXT_PUBLIC_CIVITAI_BASE_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code,
      codeVerifier: expected.verifier,
    });
    await setSession({ tokens });

    // Best-effort: never let analytics block a successful login. userKey
    // resolution hits Civitai's /me, so isolate it from the token-exchange
    // error handling below (a tracking hiccup shouldn't read as an OAuth
    // failure).
    try {
      const userKey = await getUserKey({ tokens });
      await recordEvent({ userKey, event: 'login_succeeded' });
    } catch {
      // swallow — see comment above.
    }
  } catch (err) {
    const msg =
      err instanceof OAuthError ? `token_exchange:${err.status}` : 'token_exchange_failed';
    return redirectHome(msg);
  }

  return redirectHome(undefined, 'connected');
}

// Build the post-OAuth redirect from the configured public origin, NOT from
// req.url: behind a reverse proxy (Traefik/Cloudflare) Next resolves req.url to
// the server's internal listen address (http://localhost:3000), so a req.url
// base sent users to localhost after login. NEXT_PUBLIC_APP_URL is the real
// public origin.
function redirectHome(error?: string, notice?: string): NextResponse {
  const url = new URL('/', env.NEXT_PUBLIC_APP_URL);
  if (error) url.searchParams.set('error', error);
  if (notice) url.searchParams.set('notice', notice);
  return NextResponse.redirect(url, { status: 303 });
}
