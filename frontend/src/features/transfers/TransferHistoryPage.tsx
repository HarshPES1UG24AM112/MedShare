import { TransferList } from './TransferList';

/** Closed transfers (received, rejected, cancelled); the detail view shows each one's full timeline. */
export default function TransferHistoryPage() {
  return (
    <TransferList
      kind="history"
      title="Transfer history"
      description="Received, rejected and cancelled transfers. Open one to see its approvals and timeline."
    />
  );
}
