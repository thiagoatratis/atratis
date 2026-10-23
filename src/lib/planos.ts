// Acesso a dados da etapa 5 (plano de comunicação). Permissões, seções e
// transições ficam no banco (RLS e funções de fluxo); aqui só montamos as chamadas.
import { supabase } from "./supabase";
import { ErroApp } from "./api";
import { erro } from "./criativos";
import { contarPaginas } from "./leitorPdf";
import type { DecisaoSecaoPlano, Plano, PlanoCampos, StatusPlano, VersaoPlano } from "../types";

const BUCKET = "planos";
export const LIMITE_PDF_MB = 50;

const ordenar = (vs: VersaoPlano[]): VersaoPlano[] =>
  [...vs].sort((a, b) => a.numero - b.numero)
    .map((v) => ({ ...v, secoes: [...(v.secoes ?? [])].sort((a, b) => a.ordem - b.ordem) }));

/** Sugestões de nome de seção: os blocos do PCA. */
export const SECOES_SUGERIDAS = [
  "Abertura", "Objetivos e KPIs", "Segmentação", "Concorrentes", "Personas", "Tom de voz",
  "Referências", "Linha editorial", "Calendário editorial", "Peças", "Tráfego pago",
  "Identidade visual", "Operação e próximos passos", "Encerramento",
];

/** Seções que decidem algo (as informativas não contam). */
export function contagemSecoes(v: VersaoPlano | undefined) {
  const decidir = (v?.secoes ?? []).filter((s) => s.requer_aprovacao);
  return {
    total: decidir.length,
    aprovadas: decidir.filter((s) => s.status === "aprovada").length,
    ajustes: decidir.filter((s) => s.status === "ajuste_solicitado").length,
    pendentes: decidir.filter((s) => s.status === "pendente").length,
  };
}

// ---------------- Planos ----------------

export interface ResumoPlano extends Plano {
  versoes: VersaoPlano[];
}

export async function listarPlanos(): Promise<ResumoPlano[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("*, versoes:plan_versions(*, secoes:plan_sections(*))")
    .order("updated_at", { ascending: false });
  erro(error);
  return ((data ?? []) as ResumoPlano[]).map((p) => ({ ...p, versoes: ordenar(p.versoes) }));
}

export async function obterPlano(id: string): Promise<Plano | null> {
  const { data, error } = await supabase.from("plans").select("*").eq("id", id).maybeSingle();
  erro(error);
  return data;
}

export async function criarPlano(campos: PlanoCampos): Promise<Plano> {
  const { data, error } = await supabase.from("plans").insert(campos).select().single();
  erro(error);
  return data as Plano;
}

export async function atualizarPlano(id: string, campos: Partial<Omit<PlanoCampos, "client_id">>): Promise<void> {
  const { data, error } = await supabase.from("plans").update(campos).eq("id", id).select("id");
  erro(error);
  if (!data?.length) throw new ErroApp("Este plano não pode mais ser editado.");
}

export async function listarVersoesPlano(planId: string): Promise<VersaoPlano[]> {
  const { data, error } = await supabase.from("plan_versions")
    .select("*, secoes:plan_sections(*)").eq("plan_id", planId);
  erro(error);
  return ordenar((data ?? []) as VersaoPlano[]);
}

export async function listarDecisoesPlano(planId: string): Promise<DecisaoSecaoPlano[]> {
  const { data, error } = await supabase.from("plan_section_decisions")
    .select("*").eq("plan_id", planId).order("created_at", { ascending: true });
  erro(error);
  return (data ?? []) as DecisaoSecaoPlano[];
}

export async function salvarNotaVersao(versionId: string, observacao: string): Promise<void> {
  const { error } = await supabase.from("plan_versions").update({ observacao: observacao.trim() || null }).eq("id", versionId);
  erro(error);
}

// ---------------- PDF ----------------

export function validarPdf(arquivo: File): string | null {
  const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) return "Escolha o arquivo PDF exportado do Claude Design.";
  if (arquivo.size > LIMITE_PDF_MB * 1024 * 1024) {
    return `O PDF tem ${(arquivo.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB e o limite é ${LIMITE_PDF_MB} MB. Exporte de novo com imagens mais leves.`;
  }
  return null;
}

/**
 * Sobe o PDF da versão em rascunho e registra no banco. Devolve o número de páginas.
 * O PDF anterior desta versão é apagado se nenhuma outra versão o usa.
 */
export async function enviarPdfPlano(
  ctx: { clientId: string; planId: string; versionId: string; pdfAnterior: string | null },
  arquivo: File,
  aoProgredir?: (etapa: string) => void,
): Promise<number> {
  const problema = validarPdf(arquivo);
  if (problema) throw new ErroApp(problema);
  aoProgredir?.("Lendo o PDF…");
  const paginas = await contarPaginas(arquivo);
  if (paginas > 500) throw new ErroApp("O PDF tem mais de 500 páginas.");
  aoProgredir?.("Enviando…");
  const caminho = `${ctx.clientId}/${ctx.planId}/${crypto.randomUUID()}.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: "application/pdf", upsert: false });
  if (up.error) {
    const grande = /size|exceed|large/i.test(up.error.message);
    if (grande) throw new ErroApp(`O PDF passou do limite de ${LIMITE_PDF_MB} MB.`);
    if (/row-level security|policy|unauthorized|403/i.test(up.error.message)) {
      throw new ErroApp("Você não tem permissão para enviar o PDF deste plano.");
    }
    throw new ErroApp("O PDF não subiu. Verifique a conexão e tente de novo.");
  }
  const { error } = await supabase.rpc("definir_pdf_plano", { p_version: ctx.versionId, p_path: caminho, p_paginas: paginas });
  if (error) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    erro(error);
  }
  // O Storage só deixa apagar arquivo que nenhuma versão usa; se outra versão usa, nada acontece.
  if (ctx.pdfAnterior && ctx.pdfAnterior !== caminho) await supabase.storage.from(BUCKET).remove([ctx.pdfAnterior]);
  return paginas;
}

// O leitor busca trechos do PDF aos poucos, então o endereço vale por 6 horas
// (aba parada no celular e retomada depois continua funcionando).
const cacheUrls = new Map<string, { url: string; ate: number }>();

export async function urlPdfPlano(caminho: string): Promise<string> {
  const c = cacheUrls.get(caminho);
  if (c && c.ate > Date.now()) return c.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 6 * 3600);
  if (error || !data) throw new ErroApp("Não foi possível abrir o PDF do plano.");
  cacheUrls.set(caminho, { url: data.signedUrl, ate: Date.now() + 5 * 3600 * 1000 });
  return data.signedUrl;
}

export function esquecerUrlPdfPlano(caminho: string): void {
  cacheUrls.delete(caminho);
}

/** Baixa o PDF e salva com nome legível (funciona também no iPhone). */
export async function baixarPdfPlano(caminho: string, nome: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).download(caminho);
  if (error || !data) throw new ErroApp("Não foi possível baixar o PDF.");
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------- Link da apresentação ----------------

/** Só links https do site da Atratis (a mesma regra do banco). */
export function validarLink(url: string): string | null {
  const limpo = url.trim().split("#")[0];
  if (!/^https:\/\/([a-z0-9-]+\.)*atratis\.com\.br(\/[^\s"<>#]*)?$/.test(limpo)) {
    return "Use o link https da apresentação publicada no site da Atratis (atratis.com.br).";
  }
  return null;
}

/** Forma de comparar links (a mesma do banco): ".../pca/" e ".../pca" são o mesmo endereço. */
export const chaveLink = (url: string) =>
  url.trim().split("#")[0].split("?")[0].toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "").replace(/\/+/g, "/").replace(/(\/index\.html?)?\/*$/, "");

export async function definirLinkPlano(versionId: string, url: string, slides: number): Promise<void> {
  const problema = validarLink(url);
  if (problema) throw new ErroApp(problema);
  const { error } = await supabase.rpc("definir_link_plano", { p_version: versionId, p_url: url.trim(), p_slides: slides });
  erro(error);
}

/** Tira o PDF ou o link da versão em rascunho (o outro precisa continuar). */
export async function removerMaterialPlano(versionId: string, tipo: "pdf" | "link", pdfPath?: string | null): Promise<void> {
  const { error } = await supabase.rpc("remover_material_plano", { p_version: versionId, p_tipo: tipo });
  erro(error);
  // O Storage só apaga se nenhuma outra versão usa o arquivo.
  if (tipo === "pdf" && pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath]);
}

// ---------------- Seções e fluxo ----------------

export interface SecaoEditavel {
  nome: string;
  pagina_inicio: number;
  pagina_fim: number;
  requer_aprovacao: boolean;
  mantem_aprovacao_de: string | null;
}

export async function salvarSecoes(versionId: string, secoes: SecaoEditavel[]): Promise<void> {
  const { error } = await supabase.rpc("salvar_secoes_plano", { p_version: versionId, p_secoes: secoes });
  erro(error);
}

export async function enviarPlano(id: string): Promise<StatusPlano> {
  const { data, error } = await supabase.rpc("enviar_plano", { p_plan: id });
  erro(error);
  return data as StatusPlano;
}

export async function novaVersaoPlano(id: string, observacao: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("nova_versao_plano", { p_plan: id, p_observacao: observacao });
  erro(error);
  return data as string;
}

export async function cancelarPlano(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_plano", { p_plan: id, p_motivo: motivo });
  erro(error);
}

export async function registrarVisualizacaoPlano(id: string): Promise<void> {
  const { error } = await supabase.rpc("registrar_visualizacao_plano", { p_plan: id });
  if (error) console.warn("Visualização do plano não registrada:", error.message);
}

export async function decidirSecao(
  sectionId: string, decisao: "aprovada" | "ajuste_solicitado", comentario?: string, slides: number[] = [],
): Promise<StatusPlano> {
  const { data, error } = await supabase.rpc("decidir_secao_plano", {
    p_section: sectionId, p_decisao: decisao, p_comentario: comentario?.trim() || null, p_slides: slides,
  });
  erro(error);
  return data as StatusPlano;
}

/** Texto curto com as páginas de uma seção: "slide 3" ou "slides 3 a 5". */
export const paginasDaSecao = (s: { pagina_inicio: number; pagina_fim: number }) =>
  s.pagina_inicio === s.pagina_fim ? `slide ${s.pagina_inicio}` : `slides ${s.pagina_inicio} a ${s.pagina_fim}`;

/** Lista de slides citados: "slides 7 e 8". */
export function slidesCitados(slides: number[]): string {
  if (!slides.length) return "";
  if (slides.length === 1) return `slide ${slides[0]}`;
  return `slides ${slides.slice(0, -1).join(", ")} e ${slides.at(-1)}`;
}

/** Nome do arquivo para baixar o PDF. */
export function nomeArquivoPlano(p: Plano, v: VersaoPlano): string {
  const base = p.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "plano"}-v${v.numero}.pdf`;
}

/** "1 seção", "3 seções". */
export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
