export const typeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key", "@shareable"])

  scalar DateTime

  "Orders extends the catalog's Product with sales data."
  type Product @key(fields: "id") {
    id: ID!
    "Units sold across all non-cancelled orders."
    unitsSold: Int!
  }

  type Money @shareable {
    amountCents: Int!
    currency: String!
    formatted: String!
  }

  type PageInfo @shareable {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Cart {
    id: ID!
    items: [CartItem!]!
    itemCount: Int!
    subtotal: Money!
    estimatedShipping: Money!
    estimatedTax: Money!
    estimatedTotal: Money!
  }

  type CartItem {
    productId: ID!
    product: Product!
    name: String!
    imageUrl: String!
    unitPrice: Money!
    quantity: Int!
    lineTotal: Money!
  }

  enum OrderStatus {
    PENDING
    PAID
    CONFIRMED
    SHIPPED
    DELIVERED
    CANCELLED
  }

  enum PaymentStatus {
    PENDING
    SUCCEEDED
    FAILED
    REFUNDED
  }

  enum InventoryStatus {
    PENDING
    RESERVED
    REJECTED
    RELEASED
    COMMITTED
  }

  type Order @key(fields: "id") {
    id: ID!
    number: String!
    status: OrderStatus!
    paymentStatus: PaymentStatus!
    inventoryStatus: InventoryStatus!
    items: [OrderItem!]!
    subtotal: Money!
    shipping: Money!
    tax: Money!
    total: Money!
    card: CardSummary!
    shippingAddress: Address!
    cancellationReason: String
    statusHistory: [OrderStatusChange!]!
    canCancel: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type OrderItem {
    productId: ID!
    product: Product!
    sku: String!
    name: String!
    imageUrl: String!
    unitPrice: Money!
    quantity: Int!
    lineTotal: Money!
  }

  type CardSummary {
    brand: String!
    last4: String!
  }

  type Address {
    name: String!
    line1: String!
    line2: String
    city: String!
    postalCode: String!
    country: String!
  }

  type OrderStatusChange {
    from: OrderStatus
    to: OrderStatus!
    reason: String
    at: DateTime!
  }

  type OrderEdge {
    cursor: String!
    node: Order!
  }

  type OrderConnection {
    edges: [OrderEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  "Deterministic cards understood by the simulated payment processor."
  type TestCard {
    number: String!
    brand: String!
    outcome: String!
    label: String!
    description: String!
  }

  input AddressInput {
    name: String!
    line1: String!
    line2: String
    city: String!
    postalCode: String!
    country: String!
  }

  input CheckoutInput {
    cardNumber: String!
    "MM/YY"
    cardExpiry: String!
    cardCvc: String!
    shippingAddress: AddressInput!
    "Client-generated key; retrying checkout with the same key returns the same order."
    idempotencyKey: String!
  }

  type Query {
    cart: Cart!
    myOrders(first: Int = 10, after: String): OrderConnection!
    order(id: ID!): Order
    testCards: [TestCard!]!
  }

  type Mutation {
    addToCart(productId: ID!, quantity: Int! = 1): Cart!
    updateCartItem(productId: ID!, quantity: Int!): Cart!
    removeFromCart(productId: ID!): Cart!
    clearCart: Cart!
    "Places the order and starts the checkout saga. Returns immediately in PENDING."
    checkout(input: CheckoutInput!): Order!
    cancelOrder(id: ID!): Order!
  }
`;
