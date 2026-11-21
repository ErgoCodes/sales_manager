'use client';

import { useState } from 'react';
import { proposeTransferPrice } from '@/lib/catalog/money';

/**
 * Cash + transfer price pair where the transfer price follows the domain proposal
 * (`calculateTransferPrice`) until the user types one by hand, as in mobile. An existing
 * transfer price counts as typed by hand, so editing never overwrites it silently.
 */
export function useTransferProposal(initialCash: string, initialTransfer: string) {
  const [cash, setCashValue] = useState(initialCash);
  const [transfer, setTransferValue] = useState(initialTransfer);
  const [manual, setManual] = useState(initialTransfer !== '');
  const proposal = proposeTransferPrice(cash);

  return {
    cash,
    transfer,
    proposal,
    setCash(value: string) {
      setCashValue(value);
      if (!manual) setTransferValue(proposeTransferPrice(value) ?? '');
    },
    setTransfer(value: string) {
      setTransferValue(value);
      setManual(true);
    },
    applyProposal() {
      if (proposal === null) return;
      setTransferValue(proposal);
      setManual(false);
    },
  };
}
