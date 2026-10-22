// Formatação e validação de dados brasileiros. O banco guarda só dígitos.

export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export function formatarCNPJ(v: string | null | undefined): string {
  const d = soDigitos(v);
  if (d.length !== 14) return v ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function cnpjValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d.endsWith(`${d1}${d2}`);
}

export function formatarCEP(v: string | null | undefined): string {
  const d = soDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v ?? "";
}

export const emailValido = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Data no formato dd/mm/aaaa. Datas puras (aaaa-mm-dd) não passam por fuso, para não "voltar um dia". */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  const pura = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (pura) return `${pura[3]}/${pura[2]}/${pura[1]}`;
  return fmtData.format(new Date(iso));
}
export const formatarDataHora = (iso: string | null | undefined) => (iso ? fmtDataHora.format(new Date(iso)) : "");

/** Endereço numa linha, no formato usado no P.I. */
export function enderecoCompleto(c: {
  endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null;
}): string {
  const cidadeUf = [c.cidade, c.uf].filter(Boolean).join(" - ");
  const partes = [c.endereco, c.bairro, cidadeUf, c.cep ? formatarCEP(c.cep) : null].filter(Boolean);
  return partes.join(", ");
}

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];
