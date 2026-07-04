/** Chiffres avec espaces ASCII — Helvetica PDF ne gère pas U+202F (affiché « / »). */
export function formatFcfaDigits(amount: number): string {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? "- " : "";
  return sign + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatFcfa(amount: number): string {
  return `${formatFcfaDigits(amount)} FCFA`;
}
