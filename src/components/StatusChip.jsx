import { STATUSES } from '../data/constants.js';

export default function StatusChip({ status }) {
  const s = STATUSES[status] || STATUSES.draft;
  return <span className={`status status--${status}`}>{s.label}</span>;
}
