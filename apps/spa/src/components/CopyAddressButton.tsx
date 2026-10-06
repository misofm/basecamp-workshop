import { useEffect, useState } from "react";

/** "Copy address" -> "Copied" for two seconds. */
export function CopyAddressButton({ address, label = "Copy address" }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="button-secondary"
      onClick={() => navigator.clipboard?.writeText(address).then(() => setCopied(true), () => {})}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
