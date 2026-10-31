export type PharmacySaleAmountsSource = {
  grossTotalFcfa: number | null;
  netTotalFcfa: number | null;
  saleLines: Array<{
    lineTotalFcfa: number;
    returns: Array<{ grossRefundFcfa: number; netRefundFcfa: number }>;
  }>;
};

export function pharmacySaleAmounts(sale: PharmacySaleAmountsSource) {
  const lineTotalFcfa = sale.saleLines.reduce((sum, line) => sum + line.lineTotalFcfa, 0);
  const grossTotalFcfa = sale.grossTotalFcfa ?? sale.netTotalFcfa ?? lineTotalFcfa;
  return {
    grossTotalFcfa,
    netTotalFcfa: sale.netTotalFcfa ?? grossTotalFcfa,
    returnedGrossFcfa: sale.saleLines.reduce(
      (sum, line) =>
        sum + line.returns.reduce((lineSum, item) => lineSum + item.grossRefundFcfa, 0),
      0,
    ),
    returnedNetFcfa: sale.saleLines.reduce(
      (sum, line) =>
        sum + line.returns.reduce((lineSum, item) => lineSum + item.netRefundFcfa, 0),
      0,
    ),
  };
}
