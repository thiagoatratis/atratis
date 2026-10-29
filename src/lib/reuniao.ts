// Aprovação registrada pela equipe depois de uma reunião com o cliente.
import { formatarDataHora } from "./format";

interface DecisaoComReuniao {
  via?: "portal" | "reuniao";
  reuniao_em?: string | null;
  aprovado_por_cliente?: string | null;
  observacao_reuniao?: string | null;
  user_nome: string | null;
  user_email: string | null;
  created_at: string;
}

export const emReuniao = (d: DecisaoComReuniao) => d.via === "reuniao";

/** "por Maria em 29/10 15:00" ou "em reunião de 29/10 15:00, por Maria (registrado por Thiago)". */
export function autoriaDecisao(d: DecisaoComReuniao): string {
  if (emReuniao(d)) {
    return `em reunião de ${formatarDataHora(d.reuniao_em)}, por ${d.aprovado_por_cliente} (registrado por ${d.user_nome || d.user_email})`;
  }
  return `por ${d.user_nome || d.user_email} em ${formatarDataHora(d.created_at)}`;
}

export const observacaoReuniao = (d: DecisaoComReuniao) =>
  emReuniao(d) && d.observacao_reuniao ? ` Observação: "${d.observacao_reuniao}"` : "";

/** Junta data (aaaa-mm-dd) e hora (hh:mm) do horário local num instante ISO. */
export function instanteLocal(data: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const d = new Date(`${data}T${hora}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
