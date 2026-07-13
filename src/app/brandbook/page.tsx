import type { Metadata } from "next";
import { PinGate } from "@/components/pin-gate";
import { Brandbook } from "@/components/brandbook/brandbook";
import { gateLabels } from "@/components/brandbook/brandbook-content";

export const metadata: Metadata = {
  title: "Brandbook · HallofHelp",
  robots: { index: false, follow: false },
};

/** Interne, PIN-geschützte Design-Referenz. Erreichbar unter /brandbook. */
export default function BrandbookPage() {
  return (
    <PinGate labels={gateLabels}>
      <Brandbook />
    </PinGate>
  );
}
