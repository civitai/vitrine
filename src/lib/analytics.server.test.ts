import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db/schema', () => ({ analyticsEvents: { __table: 'analytics_events' } }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: (_table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        inserts.push(row);
      },
    }),
  },
}));

import { recordEvent } from './analytics.server';

beforeEach(() => {
  inserts.length = 0;
});

describe('recordEvent', () => {
  it('inserts a row with userKey, event, props, sessionId', async () => {
    await recordEvent({
      userKey: 'u:alice',
      event: 'campaign_cook_submitted',
      props: { tiles: 4, preset: 'instagram' },
      sessionId: 'sess-1',
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      userKey: 'u:alice',
      event: 'campaign_cook_submitted',
      props: { tiles: 4, preset: 'instagram' },
      sessionId: 'sess-1',
    });
  });

  it('defaults props to {} and sessionId to null when omitted', async () => {
    await recordEvent({ userKey: 'u:bob', event: 'login_succeeded' });
    expect(inserts[0]).toMatchObject({ userKey: 'u:bob', event: 'login_succeeded', props: {}, sessionId: null });
  });

  it('never throws even if the insert rejects (analytics is best-effort)', async () => {
    const { db } = await import('@/lib/db');
    vi.spyOn(db, 'insert').mockImplementationOnce(() => ({
      values: async () => {
        throw new Error('db down');
      },
    }) as unknown as ReturnType<typeof db.insert>);
    await expect(recordEvent({ userKey: 'u:c', event: 'login_succeeded' })).resolves.toBeUndefined();
  });
});
