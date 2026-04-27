export function calculateInvoiceTotals(invoice) {
  const invoiceLines = Array.isArray(invoice.lines) ? invoice.lines : [];
  let grossAmount = 0;
  let rebateAmount = 0;
  let vatBase = 0;

  for (const line of invoiceLines) {
    const units = Number(line.units || 0);
    const price = Number(line.price || 0);
    const rebateRate = Number(line.rebateRate || 0);
    const grossLine = units * price;
    const rebateLine = grossLine * rebateRate;
    const netLine = grossLine - rebateLine;

    grossAmount += grossLine;
    rebateAmount += rebateLine;
    if (line.vatExempt !== true) {
      vatBase += netLine;
    }
  }

  const deliveryFee = Number(invoice.deliveryFee || 0);
  const vatRate = Number(invoice.vatRate || 0);
  const vat = vatBase * vatRate;
  const payable = grossAmount - rebateAmount + deliveryFee + vat;

  return {
    subtotal: Number(grossAmount.toFixed(2)),
    discountTotal: Number(rebateAmount.toFixed(2)),
    shipping: Number(deliveryFee.toFixed(2)),
    tax: Number(vat.toFixed(2)),
    total: Number(payable.toFixed(2)),
  };
}

