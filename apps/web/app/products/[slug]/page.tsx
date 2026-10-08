import { ProductView } from './product-view';

export default async function ProductPage(props: PageProps<'/products/[slug]'>) {
  const { slug } = await props.params;
  return <ProductView slug={slug} />;
}
