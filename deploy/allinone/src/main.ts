import { startTracing } from '@shopstream/platform/tracing';

const tracing = startTracing('shopstream-allinone');

void import('./index.js').then(async ({ startAllInOne }) => {
  try {
    const system = await startAllInOne();
    let stopping = false;
    const shutdown = (signal: string) => {
      if (stopping) return;
      stopping = true;
      console.log(
        JSON.stringify({ level: 'info', service: 'allinone', msg: `received ${signal}, shutting down` }),
      );
      const timer = setTimeout(() => process.exit(1), 20_000);
      timer.unref();
      void system
        .stop()
        .then(() => tracing.shutdown())
        .then(() => process.exit(0));
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('ShopStream all-in-one failed to start', err);
    process.exit(1);
  }
});
