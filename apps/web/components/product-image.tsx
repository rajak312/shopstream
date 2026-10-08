import clsx from 'clsx';

/** Product art is bundled as SVG in /public/products (no third-party hot-linking). */
export function ProductImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static local SVGs; next/image adds nothing here
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={clsx('aspect-square w-full rounded-xl object-cover', className)}
    />
  );
}
