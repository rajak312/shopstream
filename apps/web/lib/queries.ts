/** GraphQL documents used by the storefront (all resolved by the federated supergraph). */

export const MONEY = `amountCents formatted`;

export const PRODUCT_CARD = `
  id slug name imageUrl rating reviewCount available inStock lowStock
  price { ${MONEY} }
  category { slug name }
`;

export const PRODUCTS = `
  query Products($first: Int, $after: String, $filter: ProductFilter, $sort: ProductSort) {
    products(first: $first, after: $after, filter: $filter, sort: $sort) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { cursor node { ${PRODUCT_CARD} } }
    }
  }
`;

export const CATEGORIES = `query Categories { categories { id slug name productCount } }`;

export const PRODUCT_BY_SLUG = `
  query Product($slug: String!) {
    productBySlug(slug: $slug) {
      ${PRODUCT_CARD}
      sku description tags createdAt
      unitsSold
    }
  }
`;

export const CART = `
  id itemCount
  subtotal { ${MONEY} } estimatedShipping { ${MONEY} } estimatedTax { ${MONEY} } estimatedTotal { ${MONEY} }
  items { productId name imageUrl quantity unitPrice { ${MONEY} } lineTotal { ${MONEY} } product { slug available } }
`;

export const CART_QUERY = `query Cart { cart { ${CART} } }`;
export const ADD_TO_CART = `mutation Add($productId: ID!, $quantity: Int!) { addToCart(productId: $productId, quantity: $quantity) { ${CART} } }`;
export const UPDATE_CART = `mutation Update($productId: ID!, $quantity: Int!) { updateCartItem(productId: $productId, quantity: $quantity) { ${CART} } }`;
export const CLEAR_CART = `mutation Clear { clearCart { ${CART} } }`;

export const TEST_CARDS = `query TestCards { testCards { number brand outcome label description } }`;

export const ORDER_FIELDS = `
  id number status paymentStatus inventoryStatus cancellationReason canCancel createdAt updatedAt
  subtotal { ${MONEY} } shipping { ${MONEY} } tax { ${MONEY} } total { ${MONEY} }
  card { brand last4 }
  shippingAddress { name line1 line2 city postalCode country }
  items { productId name imageUrl quantity unitPrice { ${MONEY} } lineTotal { ${MONEY} } product { slug } }
  statusHistory { from to reason at }
  payment { id status attempts failureMessage amount { formatted } }
  timeline { id type source title detail tone occurredAt }
`;

export const ORDER = `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;

export const CHECKOUT = `mutation Checkout($input: CheckoutInput!) { checkout(input: $input) { id number status } }`;
export const CANCEL_ORDER = `mutation Cancel($id: ID!) { cancelOrder(id: $id) { id status } }`;

export const MY_ORDERS = `
  query MyOrders($after: String) {
    myOrders(first: 20, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { node { id number status paymentStatus createdAt total { ${MONEY} } items { name quantity imageUrl } } }
    }
  }
`;

export const AUTH_PAYLOAD = `token expiresAt user { id email name role }`;
export const LOGIN = `mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { ${AUTH_PAYLOAD} } }`;
export const REGISTER = `mutation Register($email: String!, $password: String!, $name: String!) { register(email: $email, password: $password, name: $name) { ${AUTH_PAYLOAD} } }`;
export const DEMO_LOGIN = `mutation Demo { demoLogin { ${AUTH_PAYLOAD} } }`;
export const ME = `query Me { me { id email name role } }`;
