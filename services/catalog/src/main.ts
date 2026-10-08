// Tracing must be initialised before anything else loads http/express/mongodb.
import { startTracing } from '@shopstream/platform/tracing';

startTracing('catalog');

void import('./index.js')
  .then(({ startCatalog }) => startCatalog())
  .catch((err: unknown) => {
    console.error('catalog failed to start', err);
    process.exit(1);
  });
