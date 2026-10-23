// Valores em reais, plataformas de mídia e mês de referência.

const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const formatarMoeda = (v: number | null | undefined) => fmtMoeda.format(Number(v ?? 0));

/**
 * Lê um valor digitado em reais: "1.100,00", "1100,5", "R$ 1.100" ou "1100.50".
 * Devolve null quando não dá para entender.
 */
export function lerMoeda(texto: string): number | null {
  let t = texto.replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

/** Valor para preencher o campo de edição: 1100.5 → "1.100,50". */
export const moedaParaCampo = (v: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

export const PLATAFORMAS = ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads"];
export const OUTRA_PLATAFORMA = "__outra__";

/**
 * Mesma regra do banco (private.aliquota_plataforma): só o Meta Ads tem
 * imposto, 12,15%, já incluso no valor do boleto. Aqui serve apenas para
 * mostrar a conta enquanto a pessoa digita; o valor gravado vem do banco.
 */
export const aliquotaPlataforma = (plataforma: string) =>
  plataforma.trim().toLowerCase() === "meta ads" ? 0.1215 : 0;

export function dividirValor(valor: number, aliquota: number): { verba: number; imposto: number } {
  const imposto = Math.round((valor - valor / (1 + aliquota)) * 100) / 100;
  return { imposto, verba: Math.round((valor - imposto) * 100) / 100 };
}

export const formatarAliquota = (a: number) =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(a * 100)}%`;

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "2026-11-01" → "Novembro/2026". */
export function formatarMes(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : "";
}

/** Mês seguinte ao de hoje (horário de Brasília), no formato aaaa-mm do campo de mês. */
export function proximoMes(): string {
  const [a, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
