import { SUI_WEB_FAUCET } from "../config";
import { formatSui } from "../wallet/store";
import { CopyAddressButton } from "./CopyAddressButton";

/** Not enough SUI for gas. The official faucet can't be prefilled, so offer to copy the address. */
export function GasNote({ needMist, address }: { needMist: bigint; address: string | null }) {
  return (
    <div className="buy-note">
      <p>Not enough SUI to pay for gas (about {formatSui(needMist)} SUI needed).</p>
      <p className="buy-links">
        <a href={SUI_WEB_FAUCET} target="_blank" rel="noreferrer">
          Open the Sui faucet and paste your address
        </a>
        {address && <CopyAddressButton address={address} />}
      </p>
    </div>
  );
}
