// Acesso a dados da etapa 3. Permissões, imposto e transições ficam no banco
// (RLS, colunas calculadas e funções de fluxo); aqui só montamos as chamadas.
import { supabase } from "./supabase";
import { ErroApp } from "./api";
import { erro } from "./criativos";
import { formatarMes } from "./dinheiro";
import type {
  AlteracaoOrcamento, DecisaoOrcamento, LinhaOrcamento, Orcamento, OrcamentoCampos, StatusOrcamento, VersaoOrcamento,
} from "../types";

const numeros = (l: LinhaOrcamento): LinhaOrcamento => ({
  ...l, valor: Number(l.valor), aliquota: Number(l.aliquota), imposto: Number(l.imposto), verba: Number(l.verba),
});

const ordenarVersoes = (vs: VersaoOrcamento[]): VersaoOrcamento[] =>
  [...vs].sort((a, b) => a.numero - b.numero).map((v) => ({
    ...v,
    linhas: [...(v.linhas ?? [])].map(numeros).sort((a, b) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at)),
  }));

export const tituloOrcamento = (o: Pick<Orcamento, "titulo" | "mes_referencia">) =>
  o.titulo?.trim() || `Orçamento de ${formatarMes(o.mes_referencia)}`;

/** Soma em centavos, para não acumular erro de arredondamento. */
export function totais(linhas: LinhaOrcamento[]) {
  const c = (v: number) => Math.round(v * 100);
  const t = linhas.reduce(
    (s, l) => ({ valor: s.valor + c(l.valor), verba: s.verba + c(l.verba), imposto: s.imposto + c(l.imposto) }),
    { valor: 0, verba: 0, imposto: 0 },
  );
  return { valor: t.valor / 100, verba: t.verba / 100, imposto: t.imposto / 100 };
}

// ---------------- Orçamentos ----------------

export interface ResumoOrcamento extends Orcamento {
  versoes: VersaoOrcamento[];
}

export async function listarOrcamentos(): Promise<ResumoOrcamento[]> {
  const { data, error } = await supabase
    .from("budgets")
    .select("*, versoes:budget_versions(*, linhas:budget_lines(*))")
    .order("mes_referencia", { ascending: false })
    .order("updated_at", { ascending: false });
  erro(error);
  return ((data ?? []) as ResumoOrcamento[]).map((o) => ({ ...o, versoes: ordenarVersoes(o.versoes) }));
}

export async function obterOrcamento(id: string): Promise<Orcamento | null> {
  const { data, error } = await supabase.from("budgets").select("*").eq("id", id).maybeSingle();
  erro(error);
  return data;
}

export async function criarOrcamento(campos: OrcamentoCampos): Promise<Orcamento> {
  const { data, error } = await supabase.from("budgets").insert(campos).select().single();
  erro(error);
  return data as Orcamento;
}

export async function atualizarOrcamento(id: string, campos: Partial<OrcamentoCampos>): Promise<void> {
  const { data, error } = await supabase.from("budgets").update(campos).eq("id", id).select("id");
  erro(error);
  if (!data?.length) throw new ErroApp("Este orçamento não pode mais ser editado.");
}

export async function obterObservacoesOrcamento(id: string): Promise<string> {
  const { data, error } = await supabase.from("budget_internal")
    .select("observacoes_internas").eq("budget_id", id).maybeSingle();
  erro(error);
  return data?.observacoes_internas ?? "";
}

export async function salvarObservacoesOrcamento(id: string, texto: string): Promise<void> {
  const { error } = await supabase.from("budget_internal")
    .upsert({ budget_id: id, observacoes_internas: texto.trim() || null }, { onConflict: "budget_id" });
  erro(error);
}

// ---------------- Versões e linhas ----------------

export async function listarVersoes(budgetId: string): Promise<VersaoOrcamento[]> {
  const { data, error } = await supabase.from("budget_versions")
    .select("*, linhas:budget_lines(*)").eq("budget_id", budgetId);
  erro(error);
  return ordenarVersoes((data ?? []) as VersaoOrcamento[]);
}

export interface CamposLinha { projeto: string | null; plataforma: string; descricao: string | null; valor: number }

/** Linha na ordem de exibição, com o número do canal e quantas linhas cada célula agrupada ocupa. */
export interface LinhaExibida {
  linha: LinhaOrcamento;
  numero: number;
  /** Nas linhas que abrem um projeto: quantas linhas ele tem (rowspan). */
  projetoSpan: number;
  /** Nas linhas que abrem um objetivo dentro do projeto: quantas linhas seguidas têm o mesmo objetivo. */
  objetivoSpan: number;
}

const chaveTexto = (t: string | null) => (t ?? "").trim().toLocaleLowerCase("pt-BR");

/**
 * Agrupa as linhas por projeto (na ordem em que cada projeto aparece pela
 * primeira vez) e junta objetivos iguais em sequência, como na planilha
 * "Projetos × Objetivo × Mídias". Linhas sem projeto ficam no fim.
 */
export function agruparPorProjeto(linhas: LinhaOrcamento[]): LinhaExibida[] {
  const ordenadas = [...linhas].sort((a, b) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at));
  const grupos = new Map<string, LinhaOrcamento[]>();
  for (const l of ordenadas) {
    const k = chaveTexto(l.projeto);
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const semProjeto = grupos.get("");
  grupos.delete("");
  if (semProjeto) grupos.set("", semProjeto);
  const saida: LinhaExibida[] = [];
  for (const grupo of grupos.values()) {
    grupo.forEach((l, i) => {
      let objetivoSpan = 0;
      if (i === 0 || chaveTexto(grupo[i - 1].descricao) !== chaveTexto(l.descricao)) {
        objetivoSpan = 1;
        while (i + objetivoSpan < grupo.length && chaveTexto(grupo[i + objetivoSpan].descricao) === chaveTexto(l.descricao)) objetivoSpan++;
      }
      saida.push({ linha: l, numero: saida.length + 1, projetoSpan: i === 0 ? grupo.length : 0, objetivoSpan });
    });
  }
  return saida;
}

/** Projetos já usados no orçamento (para sugerir no formulário). */
export const projetosDoOrcamento = (linhas: LinhaOrcamento[]) =>
  [...new Map(linhas.filter((l) => l.projeto).map((l) => [chaveTexto(l.projeto), l.projeto!])).values()];

export async function adicionarLinha(versionId: string, campos: CamposLinha, ordem: number): Promise<void> {
  const { error } = await supabase.from("budget_lines").insert({ version_id: versionId, ...campos, ordem });
  erro(error);
}

export async function atualizarLinha(id: string, campos: CamposLinha): Promise<void> {
  const { data, error } = await supabase.from("budget_lines").update(campos).eq("id", id).select("id");
  erro(error);
  if (!data?.length) throw new ErroApp("Esta linha não pode mais ser editada.");
}

export async function excluirLinha(id: string): Promise<void> {
  const { error } = await supabase.from("budget_lines").delete().eq("id", id);
  erro(error);
}

export async function salvarObservacaoVersao(id: string, observacao: string): Promise<void> {
  const { error } = await supabase.from("budget_versions").update({ observacao: observacao.trim() || null }).eq("id", id);
  erro(error);
}

// ---------------- Fluxo ----------------

export async function enviarOrcamento(id: string): Promise<StatusOrcamento> {
  const { data, error } = await supabase.rpc("enviar_orcamento", { p_budget: id });
  erro(error);
  return data as StatusOrcamento;
}

export async function novaVersaoOrcamento(id: string, observacao: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("nova_versao_orcamento", { p_budget: id, p_observacao: observacao });
  erro(error);
  return data as string;
}

export async function cancelarOrcamento(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_orcamento", { p_budget: id, p_motivo: motivo });
  erro(error);
}

export async function registrarVisualizacaoOrcamento(id: string): Promise<void> {
  await supabase.rpc("registrar_visualizacao_orcamento", { p_budget: id });
}

/**
 * Decisão do cliente. `totalVisto` é o total que ele tinha na tela: se a
 * equipe mudou os valores nesse meio-tempo, o banco recusa a aprovação.
 */
export async function decidirOrcamento(id: string, decisao: "aprovado" | "alteracoes_solicitadas", comentario: string | undefined,
  totalVisto: number) {
  const { data, error } = await supabase.rpc("decidir_orcamento", {
    p_budget: id, p_decisao: decisao, p_comentario: comentario ?? null, p_total_visto: totalVisto,
  });
  erro(error);
  return data as StatusOrcamento;
}

export async function listarAlteracoesOrcamento(budgetId: string): Promise<AlteracaoOrcamento[]> {
  const { data, error } = await supabase.from("budget_changes").select("*")
    .eq("budget_id", budgetId).order("created_at");
  erro(error);
  return ((data ?? []) as AlteracaoOrcamento[]).map((a) => ({
    ...a,
    valor_antes: a.valor_antes === null ? null : Number(a.valor_antes),
    valor_depois: a.valor_depois === null ? null : Number(a.valor_depois),
  }));
}

export async function listarDecisoesOrcamento(budgetId: string): Promise<DecisaoOrcamento[]> {
  const { data, error } = await supabase.from("budget_approvals").select("*")
    .eq("budget_id", budgetId).order("created_at");
  erro(error);
  return ((data ?? []) as DecisaoOrcamento[]).map((d) => ({ ...d, total: Number(d.total) }));
}

export async function aprovarOrcamentoEmReuniao(id: string, quando: string, quem: string, observacao: string): Promise<void> {
  const { error } = await supabase.rpc("aprovar_orcamento_em_reuniao", {
    p_budget: id, p_reuniao_em: quando, p_aprovado_por: quem.trim(), p_observacao: observacao.trim() || null,
  });
  erro(error);
}
