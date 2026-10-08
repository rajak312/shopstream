export const typeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key", "@shareable"])

  scalar DateTime

  "Payments extends Order with the charge made by the simulated processor."
  type Order @key(fields: "id") {
    id: ID!
    payment: Payment
  }

  enum ChargeStatus {
    SUCCEEDED
    FAILED
    REFUNDED
  }

  type Payment {
    id: ID!
    status: ChargeStatus!
    amount: Money!
    brand: String!
    last4: String!
    failureCode: String
    failureMessage: String
    "JetStream delivery attempt on which the charge was decided (shows retries)."
    attempts: Int!
    createdAt: DateTime!
    refundedAt: DateTime
  }

  type Money @shareable {
    amountCents: Int!
    currency: String!
    formatted: String!
  }
`;
