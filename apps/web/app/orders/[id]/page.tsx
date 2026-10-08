import { OrderView } from './order-view';

export default async function OrderPage(props: PageProps<'/orders/[id]'>) {
  const { id } = await props.params;
  return <OrderView id={id} />;
}
