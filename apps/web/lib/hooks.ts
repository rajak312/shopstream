'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { gql } from './graphql';
import { ADD_TO_CART, CART_QUERY, CLEAR_CART, UPDATE_CART } from './queries';
import type { Cart } from './types';

export function useCart() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['cart', session?.user.id],
    queryFn: async () => (await gql<{ cart: Cart }>(CART_QUERY)).cart,
    enabled: Boolean(session),
  });
}

export function useCartMutations() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const set = (cart: Cart) => qc.setQueryData(['cart', session?.user.id], cart);
  return {
    add: useMutation({
      mutationFn: async (v: { productId: string; quantity: number }) =>
        (await gql<{ addToCart: Cart }>(ADD_TO_CART, v)).addToCart,
      onSuccess: set,
    }),
    update: useMutation({
      mutationFn: async (v: { productId: string; quantity: number }) =>
        (await gql<{ updateCartItem: Cart }>(UPDATE_CART, v)).updateCartItem,
      onSuccess: set,
    }),
    clear: useMutation({
      mutationFn: async () => (await gql<{ clearCart: Cart }>(CLEAR_CART)).clearCart,
      onSuccess: set,
    }),
  };
}
