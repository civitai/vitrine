// Next.js 16 runs this in the browser before hydration. Keep it tiny —
// all logic lives in the (testable, gated) initFaro().
import { initFaro } from '@/lib/faro';

initFaro();
