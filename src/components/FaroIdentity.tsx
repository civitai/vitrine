'use client';

import { faro } from '@grafana/faro-web-sdk';
import { useEffect } from 'react';

/**
 * Attaches the stable user key to the Faro session so errors/RUM/replay are
 * attributable. Carries ONLY the userKey — never email or tokens. No-op when
 * Faro is uninitialized (telemetry off).
 */
export function FaroIdentity({ userKey }: { userKey: string }) {
  useEffect(() => {
    try {
      faro.api?.setUser({ id: userKey });
    } catch {
      // faro off — nothing to attribute.
    }
  }, [userKey]);
  return null;
}
