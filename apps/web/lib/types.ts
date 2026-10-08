export interface Money {
  amountCents: number;
  formatted: string;
}

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  rating: number;
  reviewCount: number;
  available: number;
  inStock: boolean;
  lowStock: boolean;
  price: Money;
  category: { slug: string; name: string };
}

export interface ProductDetail extends ProductCard {
  sku: string;
  description: string;
  tags: string[];
  createdAt: string;
  unitsSold: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  productCount: number;
}

export interface ProductPage {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: { cursor: string; node: ProductCard }[];
}

export interface CartItem {
  productId: string;
  name: string;
  imageUrl: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  product: { slug: string; available: number };
}

export interface Cart {
  id: string;
  itemCount: number;
  subtotal: Money;
  estimatedShipping: Money;
  estimatedTax: Money;
  estimatedTotal: Money;
  items: CartItem[];
}

export interface TestCard {
  number: string;
  brand: string;
  outcome: string;
  label: string;
  description: string;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface TimelineEntry {
  id: string;
  type: string;
  source: string;
  title: string;
  detail: string;
  tone: Tone;
  occurredAt: string;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: string;
  inventoryStatus: string;
  cancellationReason: string | null;
  canCancel: boolean;
  createdAt: string;
  updatedAt: string;
  subtotal: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  card: { brand: string; last4: string };
  shippingAddress: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    postalCode: string;
    country: string;
  };
  items: {
    productId: string;
    name: string;
    imageUrl: string;
    quantity: number;
    unitPrice: Money;
    lineTotal: Money;
    product: { slug: string };
  }[];
  statusHistory: { from: OrderStatus | null; to: OrderStatus; reason: string | null; at: string }[];
  payment: {
    id: string;
    status: string;
    attempts: number;
    failureMessage: string | null;
    amount: { formatted: string };
  } | null;
  timeline: TimelineEntry[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthPayload {
  token: string;
  expiresAt: string;
  user: User;
}
