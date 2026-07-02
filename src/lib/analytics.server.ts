import 'server-only';
import { db } from '@/lib/db';
import { analyticsEvents } from '@/lib/db/schema';
import type { AnalyticsEvent, AnalyticsProps } from './analytics';

/**
 * Durably persist a product-analytics event. Best-effort: analytics must never
 * break a user request, so DB failures are swallowed (logged) rather than thrown.
 * Identity (`userKey`) is always supplied by the caller from `getUserKey()` —
 * never trusted from the client.
 */
export async function recordEvent(input: {
  userKey: string;
  event: AnalyticsEvent;
  props?: AnalyticsProps;
  sessionId?: string | null;
}): Promise<void> {
  try {
    await db.insert(analyticsEvents).values({
      userKey: input.userKey,
      event: input.event,
      props: input.props ?? {},
      sessionId: input.sessionId ?? null,
    });
  } catch (err) {
    console.error('[analytics] recordEvent failed', { event: input.event, err });
  }
}
