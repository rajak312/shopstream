export const typeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key", "@shareable"])

  scalar DateTime

  "A product in the catalog. Owned by the catalog subgraph; other subgraphs extend it."
  type Product @key(fields: "id") {
    id: ID!
    sku: String!
    slug: String!
    name: String!
    description: String!
    price: Money!
    imageUrl: String!
    category: Category!
    tags: [String!]!
    rating: Float!
    reviewCount: Int!
    "Units available to buy right now (excludes reserved stock)."
    available: Int!
    inStock: Boolean!
    lowStock: Boolean!
    createdAt: DateTime!
  }

  type Category @key(fields: "id") {
    id: ID!
    slug: String!
    name: String!
    description: String!
    productCount: Int!
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

  type ProductEdge {
    cursor: String!
    node: Product!
  }

  type ProductConnection {
    edges: [ProductEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  enum ProductSort {
    RELEVANCE
    NEWEST
    PRICE_ASC
    PRICE_DESC
    NAME_ASC
  }

  input ProductFilter {
    "Full-text search over name, tags and description."
    search: String
    categorySlug: String
    minPriceCents: Int
    maxPriceCents: Int
    inStockOnly: Boolean
  }

  type Query {
    "Cursor-paginated (keyset) product listing with search and filters."
    products(first: Int = 12, after: String, filter: ProductFilter, sort: ProductSort): ProductConnection!
    product(id: ID!): Product
    productBySlug(slug: String!): Product
    categories: [Category!]!
  }
`;
