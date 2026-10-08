// Tracing must be initialised before anything else loads http/express/mongodb.
import { startTracing } from '@shopstream/platform/tracing';

startTracing('payments');

void import('./index.js')
  .then(({ startPayments }) => startPayments())
  .catch((err: unknown) => {
    console.error('payments failed to start', err);
    process.exit(1);
  });
