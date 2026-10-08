import { Star } from 'lucide-react';
import Link from 'next/link';
import type { ProductCard as Product } from '@/lib/types';
import { ProductImage } from './product-image';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group card flex flex-col overflow-hidden p-3 transition hover:-translate-y-0.5 hover:shadow-md animate-fade-in"
    >
      <div className="relative">
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          className="transition group-hover:scale-[1.02]"
        />
        {!product.inStock && (
          <span className="absolute left-2 top-2 rounded-full bg-zinc-900/80 px-2 py-0.5 text-xs font-semibold text-white">
            Sold out
          </span>
        )}
        {product.lowStock && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
            Only {product.available} left
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1 px-1">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {product.category.name}
        </p>
        <h3 className="font-semibold leading-snug text-zinc-900 group-hover:text-brand-600 dark:text-zinc-50 dark:group-hover:text-brand-400">
          {product.name}
        </h3>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-lg font-bold">{product.price.formatted}</span>
          <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            {product.rating.toFixed(1)} ({product.reviewCount})
          </span>
        </div>
      </div>
    </Link>
  );
}
