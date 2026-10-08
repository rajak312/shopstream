'use client';

import { EVENT_CATALOG, type FlowMessage } from '@shopstream/contracts';
import clsx from 'clsx';
import { AlertTriangle, CreditCard, PackageX, Play, Radio, RefreshCw, Zap } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_ORIGIN } from '@/lib/config';
import { gql } from '@/lib/graphql';

type NodeId = 'gateway' | 'orders' | 'catalog' | 'payments' | 'notifications' | 'nats' | 'dlq';

const NODES: Record<NodeId, { x: number; y: number; label: string; sub: string; color: string }> = {
  gateway: { x: 110, y: 250, label: 'Gateway', sub: 'Apollo Federation', color: '#0ea5e9' },
  orders: { x: 300, y: 80, label: 'Orders', sub: 'PostgreSQL · outbox', color: '#6366f1' },
  catalog: { x: 700, y: 80, label: 'Catalog', sub: 'MongoDB · inventory', color: '#f59e0b' },
  payments: { x: 700, y: 420, label: 'Payments', sub: 'MongoDB · processor', color: '#10b981' },
  notifications: { x: 300, y: 420, label: 'Notifications', sub: 'MongoDB · SSE', color: '#d946ef' },
  nats: { x: 500, y: 250, label: 'NATS JetStream', sub: 'SHOPSTREAM_EVENTS', color: '#64748b' },
  dlq: { x: 885, y: 250, label: 'Dead letters', sub: 'SHOPSTREAM_DLQ', color: '#e11d48' },
};

const SERVICES: NodeId[] = ['orders', 'catalog', 'payments', 'notifications'];

interface Particle {
  key: number;
  from: NodeId;
  to: NodeId;
  color: string;
  label: string;
}

const actionColor: Record<FlowMessage['action'], string> = {
  published: '#6366f1',
  consumed: '#10b981',
  retried: '#f59e0b',
  dead_lettered: '#e11d48',
  duplicate: '#94a3b8',
};

const actionLabel: Record<FlowMessage['action'], string> = {
  published: 'published',
  consumed: 'consumed',
  retried: 'retry',
  dead_lettered: 'dead-letter',
  duplicate: 'duplicate',
};

function typeColor(type: string): string {
  if (type.startsWith('payment.failed') || type.includes('rejected') || type.includes('cancelled'))
    return '#e11d48';
  if (type.includes('released') || type.includes('refunded')) return '#f59e0b';
  if (type.startsWith('payment')) return '#10b981';
  if (type.startsWith('inventory') || type.startsWith('catalog')) return '#f59e0b';
  return '#6366f1';
}

const SCENARIOS = [
  {
    id: 'happy',
    label: 'Happy path',
    card: '4242424242424242',
    icon: Play,
    hint: 'Visa 4242 — paid, reserved, confirmed, shipped',
  },
  {
    id: 'declined',
    label: 'Declined card',
    card: '4000000000000002',
    icon: CreditCard,
    hint: 'Payment fails → order cancelled → stock released',
  },
  {
    id: 'flaky',
    label: 'Flaky processor',
    card: '4000000000000119',
    icon: RefreshCw,
    hint: 'Two failed deliveries, JetStream redelivers, third succeeds',
  },
  {
    id: 'oos',
    label: 'Out of stock',
    card: '4242424242424242',
    icon: PackageX,
    hint: 'Orders 3 of a 2-unit bike → payment refunded',
  },
] as const;

export function FlowVisualizer() {
  const auth = useAuth();
  const [particles, setParticles] = useState<Particle[]>([]);
  const [log, setLog] = useState<FlowMessage[]>([]);
  const [pulse, setPulse] = useState<Partial<Record<NodeId, { at: number; color: string }>>>({});
  const [stats, setStats] = useState({
    published: 0,
    consumed: 0,
    retried: 0,
    dead_lettered: 0,
    duplicate: 0,
  });
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<{ id: string; number: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const spawn = useCallback((from: NodeId, to: NodeId, color: string, label: string, delay = 0) => {
    const key = ++seq.current;
    const add = () => {
      setParticles((p) => [...p.slice(-60), { key, from, to, color, label }]);
      setTimeout(() => {
        setParticles((p) => p.filter((x) => x.key !== key));
        setPulse((s) => ({ ...s, [to]: { at: Date.now(), color } }));
      }, 900);
    };
    if (delay) setTimeout(add, delay);
    else add();
  }, []);

  // Events arrive in bursts (a whole saga takes ~1s); replay them through a
  // queue so every hop is visible and readable.
  const queue = useRef<FlowMessage[]>([]);

  const handle = useCallback((m: FlowMessage) => {
    setLog((l) => [m, ...l].slice(0, 80));
    setStats((s) => ({ ...s, [m.action]: s[m.action] + 1 }));
    queue.current.push(m);
    if (queue.current.length > 40) queue.current.splice(0, queue.current.length - 40);
  }, []);

  const animateMessage = useCallback(
    (m: FlowMessage) => {
      const svc = m.service as NodeId;
      const color =
        m.action === 'consumed' || m.action === 'published' ? typeColor(m.type) : actionColor[m.action];
      if (m.action === 'published') spawn(svc, 'nats', color, m.type);
      else if (m.action === 'dead_lettered') {
        spawn('nats', svc, color, m.type);
        spawn('nats', 'dlq', color, m.type, 450);
      } else spawn('nats', svc, color, m.type);
    },
    [spawn],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const m = queue.current.shift();
      if (m) animateMessage(m);
    }, 260);
    return () => clearInterval(timer);
  }, [animateMessage]);

  useEffect(() => {
    const es = new EventSource(`${API_ORIGIN}/events/flow`);
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('history', (e) => {
      const items = JSON.parse((e as MessageEvent<string>).data) as FlowMessage[];
      setLog(items.slice().reverse().slice(0, 80));
    });
    es.addEventListener('flow', (e) => handle(JSON.parse((e as MessageEvent<string>).data) as FlowMessage));
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [handle]);

  const runScenario = async (scenario: (typeof SCENARIOS)[number]) => {
    setRunning(scenario.id);
    setError(null);
    try {
      if (!auth.session) await auth.demoLogin();
      const { products } = await gql<{
        products: { edges: { node: { id: string; slug: string; available: number } }[] };
      }>(`{ products(first: 50, sort: PRICE_ASC) { edges { node { id slug available } } } }`);
      const nodes = products.edges.map((e) => e.node);
      const product =
        scenario.id === 'oos'
          ? nodes.find((p) => p.slug === 'limited-edition-trail-bike')
          : nodes.find((p) => p.available > 5);
      if (!product) throw new Error('No suitable product found');
      await gql(`mutation { clearCart { itemCount } }`);
      await gql(`mutation($id: ID!, $q: Int!) { addToCart(productId: $id, quantity: $q) { itemCount } }`, {
        id: product.id,
        q: scenario.id === 'oos' ? Math.max(product.available + 1, 3) : 1,
      });
      spawn('gateway', 'orders', '#0ea5e9', 'checkout');
      const { checkout } = await gql<{ checkout: { id: string; number: string } }>(
        `mutation($input: CheckoutInput!) { checkout(input: $input) { id number } }`,
        {
          input: {
            cardNumber: scenario.card,
            cardExpiry: '12/30',
            cardCvc: '123',
            idempotencyKey: crypto.randomUUID(),
            shippingAddress: {
              name: 'Flow Demo',
              line1: '1 Event Street',
              city: 'Pune',
              postalCode: '411001',
              country: 'IN',
            },
          },
        },
      );
      setLastOrder(checkout);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Zap className="size-6 text-brand-500" /> Event flow
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Every dot is a real message: services publish domain events from their transactional outbox to
            NATS JetStream, durable consumers pull them, ack, retry with backoff or dead-letter. Run a
            scenario and watch the saga play out.
          </p>
        </div>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800',
          )}
        >
          <Radio className="size-3.5" /> {connected ? 'Streaming live' : 'Connecting…'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={running !== null}
            onClick={() => void runScenario(s)}
            className="card group flex items-start gap-3 p-4 text-left transition hover:border-brand-400 hover:shadow-md disabled:opacity-60"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
              {running === s.id ? <Spinner /> : <s.icon className="size-4" />}
            </span>
            <span>
              <span className="block font-semibold">{s.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {(error || lastOrder) && (
        <p className="text-sm">
          {error ? (
            <span className="text-rose-600">{error}</span>
          ) : (
            lastOrder && (
              <>
                Placed <span className="font-semibold">{lastOrder.number}</span> —{' '}
                <Link
                  className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                  href={`/orders/${lastOrder.id}`}
                >
                  open its live timeline →
                </Link>
              </>
            )
          )}
        </p>
      )}

      <div className="grid gap-6">
        <section className="card overflow-hidden p-2">
          <svg
            viewBox="0 0 1000 500"
            className="h-auto w-full"
            role="img"
            aria-label="Live diagram of events flowing between services"
          >
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  className="stroke-zinc-200/70 dark:stroke-zinc-800/70"
                  strokeWidth="1"
                />
              </pattern>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width="1000" height="500" fill="url(#grid)" />
            <line
              x1={NODES.gateway.x}
              y1={NODES.gateway.y}
              x2={NODES.orders.x}
              y2={NODES.orders.y}
              className="stroke-sky-400/60"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
            <text x={190} y={158} textAnchor="end" className="fill-sky-500 text-[12px] font-medium">
              GraphQL over HTTP
            </text>
            {SERVICES.map((id) => (
              <line
                key={id}
                x1={NODES[id].x}
                y1={NODES[id].y}
                x2={NODES.nats.x}
                y2={NODES.nats.y}
                className="stroke-zinc-300 dark:stroke-zinc-700"
                strokeWidth="2"
              />
            ))}
            <line
              x1={NODES.nats.x}
              y1={NODES.nats.y}
              x2={NODES.dlq.x}
              y2={NODES.dlq.y}
              className="stroke-rose-300 dark:stroke-rose-900"
              strokeWidth="2"
              strokeDasharray="4 6"
            />

            {(Object.keys(NODES) as NodeId[]).map((id) => (
              <NodeShape key={id} id={id} pulse={pulse[id]} />
            ))}
            {particles.map((p) => (
              <ParticleDot key={p.key} p={p} />
            ))}
          </svg>
          <div className="flex flex-wrap gap-4 px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400">
            <Legend color="#6366f1" label="order events" />
            <Legend color="#10b981" label="payment events" />
            <Legend color="#f59e0b" label="inventory / compensation" />
            <Legend color="#e11d48" label="failure / dead-letter" />
          </div>
        </section>

        <section className="card flex max-h-[420px] flex-col">
          <div className="grid grid-cols-5 gap-1 border-b border-zinc-200 p-3 text-center dark:border-zinc-800">
            {(Object.keys(stats) as (keyof typeof stats)[]).map((k) => (
              <div key={k}>
                <div className="text-lg font-bold tabular-nums" style={{ color: actionColor[k] }}>
                  {stats[k]}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">{actionLabel[k]}</div>
              </div>
            ))}
          </div>
          <ol className="flex-1 space-y-1 overflow-y-auto p-3 font-mono text-xs">
            {log.length === 0 && (
              <li className="p-4 text-center font-sans text-sm text-zinc-500">
                Run a scenario to see events.
              </li>
            )}
            {log.map((m, i) => (
              <li
                key={`${m.eventId}-${m.service}-${m.action}-${m.attempt}-${i}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <span className="text-zinc-400 tabular-nums">
                  {new Date(m.at).toLocaleTimeString([], { hour12: false })}
                </span>
                <span
                  className="w-[110px] shrink-0 truncate font-semibold"
                  style={{ color: NODES[m.service as NodeId]?.color }}
                >
                  {m.service}
                </span>
                <span className="w-[100px] shrink-0 truncate" style={{ color: actionColor[m.action] }}>
                  {actionLabel[m.action]}
                  {m.action === 'retried' ? ` #${m.attempt}` : ''}
                </span>
                <span className="truncate text-zinc-700 dark:text-zinc-200" title={m.error ?? m.type}>
                  {m.type}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 font-semibold">Event catalog</h2>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="py-2 pr-4">Event</th>
              <th className="py-2 pr-4">Producer</th>
              <th className="py-2 pr-4">Consumers</th>
              <th className="py-2">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {EVENT_CATALOG.map((e) => (
              <tr key={e.type}>
                <td className="py-2 pr-4 font-mono text-xs" style={{ color: typeColor(e.type) }}>
                  {e.type}
                </td>
                <td className="py-2 pr-4">{e.producer}</td>
                <td className="py-2 pr-4">{e.consumers.join(', ')}</td>
                <td className="py-2 text-zinc-500 dark:text-zinc-400">{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
          <AlertTriangle className="size-3.5" /> Delivery is at-least-once; every consumer is idempotent
          (processed-event markers written in the same transaction as its side effects).
        </p>
      </section>
    </div>
  );
}

function NodeShape({ id, pulse }: { id: NodeId; pulse?: { at: number; color: string } }) {
  const n = NODES[id];
  const isHub = id === 'nats';
  const w = isHub ? 210 : 175;
  const h = isHub ? 76 : 64;
  return (
    <g transform={`translate(${n.x - w / 2} ${n.y - h / 2})`}>
      {pulse && (
        <rect
          key={pulse.at}
          x={-4}
          y={-4}
          width={w + 8}
          height={h + 8}
          rx={18}
          fill="none"
          stroke={pulse.color}
          strokeWidth={3}
          style={{ animation: 'flowPulse 0.9s ease-out forwards' }}
        />
      )}
      <rect
        width={w}
        height={h}
        rx={14}
        className="fill-white dark:fill-zinc-900"
        stroke={n.color}
        strokeWidth={isHub ? 3 : 2}
      />
      <circle cx={18} cy={h / 2} r={6} fill={n.color} />
      <text x={32} y={h / 2 - 4} className="fill-zinc-900 text-[16px] font-semibold dark:fill-zinc-50">
        {n.label}
      </text>
      <text x={32} y={h / 2 + 15} className="fill-zinc-500 text-[12px] dark:fill-zinc-400">
        {n.sub}
      </text>
    </g>
  );
}

function ParticleDot({ p }: { p: Particle }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const a = NODES[p.from];
    const b = NODES[p.to];
    ref.current?.animate(
      [{ transform: `translate(${a.x}px, ${a.y}px)` }, { transform: `translate(${b.x}px, ${b.y}px)` }],
      {
        duration: 900,
        easing: 'cubic-bezier(.4,0,.2,1)',
        fill: 'forwards',
      },
    );
  }, [p]);
  const a = NODES[p.from];
  return (
    <g ref={ref} style={{ transform: `translate(${a.x}px, ${a.y}px)` }}>
      <circle r={8} fill={p.color} filter="url(#glow)" />
      <text
        y={-14}
        textAnchor="middle"
        className="fill-zinc-700 text-[12px] font-semibold dark:fill-zinc-200"
      >
        {p.label}
      </text>
    </g>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
