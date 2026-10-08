export const typeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key"])

  scalar DateTime

  "Notifications extends Order with its live event timeline."
  type Order @key(fields: "id") {
    id: ID!
    timeline: [TimelineEntry!]!
  }

  enum Tone {
    info
    success
    warning
    danger
  }

  type TimelineEntry {
    id: ID!
    type: String!
    "Service that emitted the event."
    source: String!
    title: String!
    detail: String!
    tone: Tone!
    occurredAt: DateTime!
  }

  type Notification {
    id: ID!
    orderId: ID!
    type: String!
    title: String!
    body: String!
    tone: Tone!
    read: Boolean!
    createdAt: DateTime!
  }

  type Query {
    notifications(first: Int = 20): [Notification!]!
    unreadNotificationCount: Int!
  }

  type Mutation {
    markNotificationsRead: Int!
  }
`;
