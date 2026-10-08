// Tracing must be initialised before anything else loads http/express/pg.
import { startTracing } from '@shopstream/platform/tracing';

startTracing('orders');

void import('./index.js')
  .then(({ startOrders }) => startOrders())
  .catch((err: unknown) => {
    console.error('orders failed to start', err);
    process.exit(1);
  });
