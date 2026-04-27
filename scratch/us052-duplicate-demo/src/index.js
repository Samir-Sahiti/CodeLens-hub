import { calculateOrderTotals } from './orderTotals.js';
import { calculateInvoiceTotals } from './invoiceTotals.js';

const order = {
  items: [
    { quantity: 2, unitPrice: 25, discountRate: 0.1, taxable: true },
    { quantity: 1, unitPrice: 10, discountRate: 0, taxable: false },
  ],
  shipping: 5,
  taxRate: 0.2,
};

const invoice = {
  lines: [
    { units: 2, price: 25, rebateRate: 0.1, vatExempt: false },
    { units: 1, price: 10, rebateRate: 0, vatExempt: true },
  ],
  deliveryFee: 5,
  vatRate: 0.2,
};

console.log(calculateOrderTotals(order));
console.log(calculateInvoiceTotals(invoice));

