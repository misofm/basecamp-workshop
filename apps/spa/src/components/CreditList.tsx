import { Link } from "react-router";
import { formatRole } from "../lib/media";
import type { Credit } from "../lib/types";

export function CreditList({ title, credits }: { title: string; credits: Credit[] }) {
  if (credits.length === 0) return null;
  return (
    <div className="credit-list">
      <h4>{title}</h4>
      <ul>
        {credits.map((credit) => (
          <li key={credit.partyId + credit.roles.join()}>
            <Link to={`/artist/${credit.partyId}`}>{credit.displayName}</Link>
            <span className="muted"> · {credit.roles.map(formatRole).join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
