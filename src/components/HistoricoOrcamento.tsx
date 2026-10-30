import { formatarMoeda } from "../lib/dinheiro";
import { formatarDataHora } from "../lib/format";
import type { AlteracaoOrcamento, VersaoOrcamento } from "../types";

const linha = (plataforma: string, descricao: string | null) => (descricao ? `${plataforma} (${descricao})` : plataforma);
const noProjeto = (projeto: string | null | undefined) => (projeto ? ` no projeto ${projeto}` : "");
const noBloco = (bloco: string | null | undefined) => (bloco && bloco !== "Geral" ? ` (bloco ${bloco})` : "");

function frase(a: AlteracaoOrcamento): string {
  if (a.acao === "incluida") return `incluiu ${linha(a.plataforma, a.descricao)}${noProjeto(a.projeto)}${noBloco(a.bloco)}: ${formatarMoeda(a.valor_depois ?? 0)}`;
  if (a.acao === "removida") return `removeu ${linha(a.plataforma, a.descricao)}${noProjeto(a.projeto)}${noBloco(a.bloco)}, que era ${formatarMoeda(a.valor_antes ?? 0)}`;
  const nomeAntes = linha(a.plataforma_antes ?? a.plataforma, a.descricao_antes);
  const nomeDepois = linha(a.plataforma, a.descricao);
  const partes: string[] = [];
  if (nomeAntes !== nomeDepois) partes.push(`trocou ${nomeAntes} por ${nomeDepois}`);
  // Registros antigos (antes do campo projeto) vêm sem projeto nos dois lados.
  if ((a.projeto ?? "") !== (a.projeto_antes ?? "")) {
    partes.push(`${partes.length ? "e passou" : `passou ${nomeDepois}`} ${a.projeto_antes ? `do projeto ${a.projeto_antes} ` : ""}para ${a.projeto ? `o projeto ${a.projeto}` : "sem projeto"}`);
  }
  if (a.bloco_antes && a.bloco && a.bloco_antes !== a.bloco) {
    partes.push(`${partes.length ? "e passou" : `passou ${nomeDepois}`} do bloco ${a.bloco_antes} para o bloco ${a.bloco}`);
  }
  if (a.valor_antes !== a.valor_depois) {
    partes.push(`${partes.length ? "e mudou" : `mudou ${nomeDepois}`} de ${formatarMoeda(a.valor_antes ?? 0)} para ${formatarMoeda(a.valor_depois ?? 0)}`);
  }
  return partes.join(" ") || `alterou ${nomeDepois}`;
}

/**
 * Mudanças nos valores depois do envio: o que mudou, de quanto para quanto,
 * quem e quando. A equipe e o cliente veem a mesma lista.
 */
export function HistoricoOrcamento({ alteracoes, versoes }: { alteracoes: AlteracaoOrcamento[]; versoes: VersaoOrcamento[] }) {
  if (!alteracoes.length) return null;
  const numero = new Map(versoes.map((v) => [v.id, v.numero]));
  const variasVersoes = new Set(alteracoes.map((a) => a.version_id)).size > 1;
  return (
    <section className="historico-orcamento" aria-labelledby="titulo-historico-orc">
      <h3 id="titulo-historico-orc">Alterações depois do envio</h3>
      <ol>
        {[...alteracoes].reverse().map((a) => (
          <li key={a.id}>
            <span className="suave">{formatarDataHora(a.created_at)}</span>{" "}
            <strong>{a.user_nome || a.user_email || "Atratis"}</strong> {frase(a)}
            {variasVersoes && <span className="suave"> (versão {numero.get(a.version_id)})</span>}
            {a.status_orcamento === "aprovado" && <span className="selo selo-atencao historico-marca">depois da aprovação</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Última mudança feita depois do envio da versão (para avisar o cliente). */
export function ultimaAlteracao(alteracoes: AlteracaoOrcamento[], versao: VersaoOrcamento | undefined) {
  if (!versao) return undefined;
  return alteracoes.filter((a) => a.version_id === versao.id).at(-1);
}
