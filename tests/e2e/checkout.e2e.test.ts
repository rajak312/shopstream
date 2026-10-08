/**
 * Full-system test: real MongoDB (replica set), PostgreSQL and NATS JetStream in
 * containers; every ShopStream service booted in-process from the compiled build;
 * all interaction goes through the federated GraphQL gateway, exactly like the web app.
 */
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { connect, headers as natsHeaders, type NatsConnection } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import { createEvent, eventSubject } from '@shopstream/contracts';
import { startAllInOne, type AllInOne } from '@shopstream/allinone';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphQLClient, eventually, freePort } from './helpers';

const ORDER = `query($id: ID!) { order(id: $id) {
  id number status paymentStatus inventoryStatus
  total { amountCents } payment { status attempts }
  timeline { type source } statusHistory { from to }
} }`;

interface Order {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  inventoryStatus: string;
  total: { amountCents: number };
  payment: { status: string; attempts: number } | null;
  timeline: { type: string; source: string }[];
  statusHistory: { from: string | null; to: string }[];
}

let mongo: StartedMongoDBContainer;
let postgres: StartedPostgreSqlContainer;
let nats: StartedTestContainer;
let system: AllInOne;
let natsUrl: string;
const api = (url: string) => new GraphQLClient(url);
let client: GraphQLClient;

beforeAll(async () => {
  [mongo, postgres, nats] = await Promise.all([
    new MongoDBContainer('mongo:7.0').start(),
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new GenericContainer('nats:2.12-alpine')
      .withCommand(['-js'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .start(),
  ]);
  natsUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
  const port = await freePort();
  const base = await freePort();
  system = await startAllInOne({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    PORT: String(port),
    INTERNAL_PORT_BASE: String(base),
    NATS_EMBEDDED: 'false',
    NATS_URL: natsUrl,
    NATS_STREAM_STORAGE: 'memory',
    MONGODB_URI: `${mongo.getConnectionString()}?directConnection=true`,
    DATABASE_URL: postgres.getConnectionUri(),
    JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
    PAYMENT_LATENCY_MS: '0',
    FULFILLMENT_SHIP_AFTER_MS: '300',
    FULFILLMENT_DELIVER_AFTER_MS: '300',
    SUPERGRAPH_POLL_MS: '0',
    OTEL_SDK_DISABLED: 'true',
  });
  client = api(system.gatewayUrl);
  const login = await client.request<{ demoLogin: { token: string } }>(`mutation { demoLogin { token } }`);
  client.token = login.demoLogin.token;
});

afterAll(async () => {
  await system?.stop();
  await Promise.allSettled([mongo?.stop(), postgres?.stop(), nats?.stop()]);
});

async function productBySlug(slug: string) {
  const d = await client.request<{ productBySlug: { id: string; available: number } }>(
    `query($s: String!) { productBySlug(slug: $s) { id available } }`,
    { s: slug },
  );
  return d.productBySlug;
}

/** Waits until the orders service has received the catalog's product replica. */
async function addToCart(productId: string, quantity: number) {
  await client.request(`mutation { clearCart { itemCount } }`);
  await eventually(
    () =>
      client
        .raw(`mutation($id: ID!, $q: Int!) { addToCart(productId: $id, quantity: $q) { itemCount } }`, {
          id: productId,
          q: quantity,
        })
        .then((r) => !r.errors),
    (ok) => ok,
  );
}

async function checkout(cardNumber: string, idempotencyKey = crypto.randomUUID()) {
  const d = await client.request<{ checkout: Order }>(
    `mutation($input: CheckoutInput!) { checkout(input: $input) { id number status } }`,
    {
      input: {
        cardNumber,
        cardExpiry: '12/39',
        cardCvc: '123',
        idempotencyKey,
        shippingAddress: {
          name: 'E2E',
          line1: '1 Test St',
          city: 'Pune',
          postalCode: '411001',
          country: 'IN',
        },
      },
    },
  );
  return d.checkout;
}

const getOrder = async (id: string) => (await client.request<{ order: Order }>(ORDER, { id })).order;
const waitOrder = (id: string, check: (o: Order) => boolean, timeoutMs?: number) =>
  eventually(() => getOrder(id), check, timeoutMs);

describe('checkout saga through the federated gateway', () => {
  it('rejects anonymous access to the cart', async () => {
    const res = await api(system.gatewayUrl).raw(`{ cart { itemCount } }`);
    expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('happy path: pays, reserves, confirms, ships and delivers; stock is committed', async () => {
    const product = await productBySlug('glide-wireless-mouse');
    await addToCart(product.id, 2);
    const placed = await checkout('4242424242424242');
    expect(placed.status).toBe('PENDING');

    const confirmed = await waitOrder(placed.id, (o) =>
      ['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(o.status),
    );
    expect(confirmed.paymentStatus).toBe('SUCCEEDED');
    expect(confirmed.payment?.status).toBe('SUCCEEDED');

    const delivered = await waitOrder(
      placed.id,
      (o) => o.status === 'DELIVERED' && o.inventoryStatus === 'COMMITTED',
    );
    expect(delivered.statusHistory.map((h) => h.to)).toEqual(
      expect.arrayContaining(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED']),
    );
    expect((await productBySlug('glide-wireless-mouse')).available).toBe(product.available - 2);

    const timeline = await waitOrder(placed.id, (o) => o.timeline.some((t) => t.type === 'order.delivered'));
    expect(timeline.timeline.map((t) => t.type)).toEqual(
      expect.arrayContaining([
        'order.created',
        'payment.succeeded',
        'inventory.reserved',
        'order.confirmed',
        'order.shipped',
      ]),
    );
  });

  it('declined card: cancels the order and releases the reserved stock (compensation)', async () => {
    const product = await productBySlug('beacon-headlamp');
    await addToCart(product.id, 3);
    const placed = await checkout('4000000000000002');

    const cancelled = await waitOrder(
      placed.id,
      (o) => o.status === 'CANCELLED' && o.inventoryStatus === 'RELEASED',
    );
    expect(cancelled.paymentStatus).toBe('FAILED');
    expect(cancelled.payment?.status).toBe('FAILED');
    expect((await productBySlug('beacon-headlamp')).available).toBe(product.available);
  });

  it('out of stock: cancels and refunds the captured payment (compensation)', async () => {
    const bike = await productBySlug('limited-edition-trail-bike');
    await addToCart(bike.id, bike.available + 1);
    const placed = await checkout('4242424242424242');

    const cancelled = await waitOrder(
      placed.id,
      (o) => o.status === 'CANCELLED' && o.paymentStatus === 'REFUNDED',
    );
    expect(cancelled.inventoryStatus).toBe('REJECTED');
    expect(cancelled.payment?.status).toBe('REFUNDED');
    expect((await productBySlug('limited-edition-trail-bike')).available).toBe(bike.available);
  });

  it('flaky processor: JetStream redelivers until the charge succeeds', async () => {
    const product = await productBySlug('cold-brew-bottle');
    await addToCart(product.id, 1);
    const placed = await checkout('4000000000000119');
    const confirmed = await waitOrder(placed.id, (o) => o.paymentStatus === 'SUCCEEDED', 60_000);
    expect(confirmed.payment?.attempts).toBe(3);
  });

  it('checkout is idempotent per client key', async () => {
    const product = await productBySlug('field-compass');
    await addToCart(product.id, 1);
    const key = crypto.randomUUID();
    const first = await checkout('4242424242424242', key);
    const second = await checkout('4242424242424242', key);
    expect(second.id).toBe(first.id);
  });

  it('consumers are idempotent: a redelivered event is applied once', async () => {
    const product = await productBySlug('pour-over-coffee-set');
    await addToCart(product.id, 1);
    const placed = await checkout('4000000000009995');
    const order = await waitOrder(placed.id, (o) => o.status === 'CANCELLED' && o.timeline.length >= 3);
    const userId = JSON.parse(Buffer.from(client.token!.split('.')[1]!, 'base64url').toString())
      .sub as string;

    // Publish the *same* event twice, bypassing broker-side de-duplication (no Nats-Msg-Id),
    // to simulate an at-least-once redelivery.
    const event = createEvent('payment.refunded', 'payments', {
      orderId: order.id,
      userId,
      paymentId: 'pay_e2e',
      amountCents: order.total.amountCents,
      currency: 'USD',
      reason: 'e2e duplicate delivery test',
    });
    const nc: NatsConnection = await connect({ servers: natsUrl });
    const js = jetstream(nc);
    for (let i = 0; i < 2; i++) {
      const h = natsHeaders();
      h.set('ce-id', event.id);
      await js.publish(eventSubject('payment.refunded'), JSON.stringify(event), { headers: h });
    }
    await nc.drain();

    const after = await waitOrder(
      order.id,
      (o) => o.paymentStatus === 'REFUNDED' && o.timeline.some((t) => t.type === 'payment.refunded'),
    );
    await new Promise((r) => setTimeout(r, 1_000));
    const final = await getOrder(after.id);
    expect(final.timeline.filter((t) => t.type === 'payment.refunded')).toHaveLength(1);
  });
});
