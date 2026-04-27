export function calculateOrderTotals(order) {
  const lineItems = Array.isArray(order.items) ? order.items : [];
  let subtotal = 0;
  let discountTotal = 0;
  let taxableAmount = 0;

  for (const item of lineItems) {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const discountRate = Number(item.discountRate || 0);
    const lineSubtotal = quantity * unitPrice;
    const lineDiscount = lineSubtotal * discountRate;
    const lineAfterDiscount = lineSubtotal - lineDiscount;

    subtotal += lineSubtotal;
    discountTotal += lineDiscount;
    if (item.taxable !== false) {
      taxableAmount += lineAfterDiscount;
    }
  }

  const shipping = Number(order.shipping || 0);
  const taxRate = Number(order.taxRate || 0);
  const tax = taxableAmount * taxRate;
  const total = subtotal - discountTotal + shipping + tax;

  return {
    subtotal: Number(subtotal.toFixed(2)),
    discountTotal: Number(discountTotal.toFixed(2)),
    shipping: Number(shipping.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

