import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ANALYTICS_EVENTS } from '@/lib/analytics';
import { recordEvent } from '@/lib/analytics.server';
import { getSession } from '@/lib/session';
import { getUserKey } from '@/lib/userKey';

const bodySchema = z.object({
  event: z.enum(ANALYTICS_EVENTS),
  props: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  sessionId: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  }

  // Identity is ALWAYS server-derived — any client-supplied userKey is ignored.
  const userKey = await getUserKey(session);
  await recordEvent({
    userKey,
    event: parsed.data.event,
    props: parsed.data.props ?? {},
    sessionId: parsed.data.sessionId ?? null,
  });
  return new NextResponse(null, { status: 204 });
}
