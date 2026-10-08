// Tracing must be initialised before anything else loads http/express/mongodb.
import { startTracing } from '@shopstream/platform/tracing';

startTracing('notifications');

void import('./index.js')
  .then(({ startNotifications }) => startNotifications())
  .catch((err: unknown) => {
    console.error('notifications failed to start', err);
    process.exit(1);
  });
