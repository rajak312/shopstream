// Tracing must be initialised before anything else loads http/express/mongodb.
import { startTracing } from '@shopstream/platform/tracing';

startTracing('gateway');

void import('./index.js')
  .then(({ startGateway }) => startGateway())
  .catch((err: unknown) => {
    console.error('gateway failed to start', err);
    process.exit(1);
  });
