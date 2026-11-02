import { TransferList } from './TransferList';

/** Transfer management: active transfers (pending, approved, in transit) and what is waiting on the caller. */
export default function TransfersPage() {
  return (
    <TransferList
      kind="active"
      title="Transfers"
      description="Active inter-facility transfers, from request through approval and dispatch to receipt."
    />
  );
}
