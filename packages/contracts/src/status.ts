export const ORDER_STATUSES = ['PENDING', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVENTORY_STATUSES = ['PENDING', 'RESERVED', 'REJECTED', 'RELEASED', 'COMMITTED'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const CANCELLATION_REASONS = ['payment_failed', 'out_of_stock', 'customer_request'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
