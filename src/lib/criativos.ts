// Acesso a dados da etapa 2. Permissões e transições ficam no banco (RLS e
// funções de fluxo); aqui só montamos as chamadas e traduzimos erros.
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ErroApp } from "./api";
import { LIMITE_BYTES, TIPOS_ACEITOS } from "./canais";
import type {
  Campanha, Comentario, Decisao, Peca, Solicitacao, SolicitacaoCampos, StatusSolicitacao, Versao,
} from "../types";

const BUCKET = "criativos";

export function erro(e: PostgrestError | null): void {
  if (!e) return;
  if (e.code === "P0001" || e.code === "22023") throw new ErroApp(e.message);
  if (e.code === "42501") {
    throw new ErroApp(/new row|policy/i.test(e.message) ? "Você não tem permissão para essa ação." : e.message);
  }
  if (e.code === "23505") throw new ErroApp("Já existe um registro com esse nome.");
  if (e.code === "23514") throw new ErroApp("Algum campo está em formato inválido.");
  throw new ErroApp(e.message);
}

// ---------------- Campanhas ----------------

export async function listarCampanhas(clientId: string): Promise<Campanha[]> {
  const { data, error } = await supabase.from("campaigns").select("*").eq("client_id", clientId).order("nome");
  erro(error);
  return data ?? [];
}

export async function criarCampanha(clientId: string, nome: string, objetivo: string | null): Promise<Campanha> {
  const { data, error } = await supabase.from("campaigns")
    .insert({ client_id: clientId, nome: nome.trim(), objetivo }).select().single();
  erro(error);
  return data as Campanha;
}

// ---------------- Solicitações ----------------

export interface ResumoSolicitacao extends Solicitacao {
  pecas: { id: string; canal: string; ativo: boolean }[];
}

export async function listarSolicitacoes(): Promise<ResumoSolicitacao[]> {
  const { data, error } = await supabase
    .from("creative_requests")
    .select("*, pecas:creative_pieces(id, canal, ativo)")
    .order("updated_at", { ascending: false });
  erro(error);
  return (data ?? []) as ResumoSolicitacao[];
}

export async function obterSolicitacao(id: string): Promise<Solicitacao | null> {
  const { data, error } = await supabase.from("creative_requests").select("*").eq("id", id).maybeSingle();
  erro(error);
  return data;
}

export async function criarSolicitacao(campos: SolicitacaoCampos): Promise<Solicitacao> {
  const { data, error } = await supabase.from("creative_requests").insert(campos).select().single();
  erro(error);
  return data as Solicitacao;
}

export async function atualizarSolicitacao(id: string, campos: Partial<SolicitacaoCampos>): Promise<void> {
  const { data, error } = await supabase.from("creative_requests").update(campos).eq("id", id).select("id");
  erro(error);
  if (!data?.length) throw new ErroApp("Esta solicitação não pode mais ser editada.");
}

export async function obterObservacoesSolicitacao(id: string): Promise<string> {
  const { data, error } = await supabase.from("creative_request_internal")
    .select("observacoes_internas").eq("request_id", id).maybeSingle();
  erro(error);
  return data?.observacoes_internas ?? "";
}

export async function salvarObservacoesSolicitacao(id: string, texto: string): Promise<void> {
  const { error } = await supabase.from("creative_request_internal")
    .upsert({ request_id: id, observacoes_internas: texto.trim() || null }, { onConflict: "request_id" });
  erro(error);
}

// ---------------- Peças e versões ----------------

export async function listarPecas(requestId: string): Promise<Peca[]> {
  const { data, error } = await supabase
    .from("creative_pieces")
    .select("*, versoes:piece_versions(*)")
    .eq("request_id", requestId)
    .order("ordem").order("created_at");
  erro(error);
  return ((data ?? []) as Peca[]).map((p) => ({ ...p, versoes: [...p.versoes].sort((a, b) => a.numero - b.numero) }));
}

export const versaoAtual = (p: Peca): Versao | undefined => p.versoes[p.versoes.length - 1];

export async function criarPeca(requestId: string, campos: { nome: string; canal: string; formato: string; descricao: string | null; ordem: number }): Promise<string> {
  const { data, error } = await supabase.from("creative_pieces")
    .insert({ request_id: requestId, ...campos }).select("id").single();
  erro(error);
  return (data as { id: string }).id;
}

export async function atualizarPeca(id: string, campos: Partial<{ nome: string; canal: string; formato: string; descricao: string | null }>) {
  const { error } = await supabase.from("creative_pieces").update(campos).eq("id", id);
  erro(error);
}

export async function excluirPeca(peca: Peca): Promise<void> {
  const caminhos = peca.versoes.map((v) => v.storage_path).filter(Boolean) as string[];
  const { error } = await supabase.from("creative_pieces").delete().eq("id", peca.id);
  erro(error);
  if (caminhos.length) await supabase.storage.from(BUCKET).remove(caminhos);
}

export async function retirarPeca(id: string): Promise<void> {
  const { error } = await supabase.rpc("retirar_peca", { p_piece: id });
  erro(error);
}

function nomeSeguro(nome: string): string {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  return base.slice(-80) || "arquivo";
}

export function validarArquivo(arquivo: File): string | null {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) return "Formato não aceito. Use JPG, PNG, WEBP, MP4 ou PDF.";
  if (arquivo.size > LIMITE_BYTES) return "Arquivo acima de 50 MB. Para vídeos grandes, envie como link do Drive.";
  return null;
}

/** Envia o arquivo para o Storage e cria a versão (rascunho). */
export async function criarVersaoArquivo(
  ctx: { clientId: string; requestId: string; pieceId: string }, arquivo: File, observacao: string | null,
): Promise<void> {
  const problema = validarArquivo(arquivo);
  if (problema) throw new ErroApp(problema);
  const caminho = `${ctx.clientId}/${ctx.requestId}/${ctx.pieceId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) throw new ErroApp(`O arquivo não subiu: ${up.error.message}`);
  const { error } = await supabase.from("piece_versions").insert({
    piece_id: ctx.pieceId, tipo: "arquivo", storage_path: caminho, nome_arquivo: arquivo.name,
    mime_type: arquivo.type, tamanho_bytes: arquivo.size, observacao,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    erro(error);
  }
}

export async function criarVersaoLink(pieceId: string, url: string, observacao: string | null): Promise<void> {
  if (!/^https?:\/\//i.test(url.trim())) throw new ErroApp("O link precisa começar com https://");
  const { error } = await supabase.from("piece_versions").insert({
    piece_id: pieceId, tipo: "link", link_url: url.trim(), observacao,
  });
  erro(error);
}

/** Apaga uma versão ainda não enviada (para trocar o arquivo ou o link). */
export async function descartarRascunho(v: Versao): Promise<void> {
  const { error } = await supabase.from("piece_versions").delete().eq("id", v.id);
  erro(error);
  if (v.storage_path) await supabase.storage.from(BUCKET).remove([v.storage_path]);
}

const cacheUrls = new Map<string, { url: string; ate: number }>();

export async function urlArquivo(caminho: string, baixar = false): Promise<string> {
  const chave = `${caminho}|${baixar}`;
  const c = cacheUrls.get(chave);
  if (c && c.ate > Date.now()) return c.url;
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(caminho, 3600, baixar ? { download: true } : undefined);
  if (error || !data) throw new ErroApp("Não foi possível abrir o arquivo.");
  cacheUrls.set(chave, { url: data.signedUrl, ate: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

// ---------------- Fluxo ----------------

export async function enviarSolicitacao(id: string): Promise<StatusSolicitacao> {
  const { data, error } = await supabase.rpc("enviar_solicitacao", { p_request: id });
  erro(error);
  return data as StatusSolicitacao;
}

export async function cancelarSolicitacao(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_solicitacao", { p_request: id, p_motivo: motivo });
  erro(error);
}

export async function registrarVisualizacao(id: string): Promise<void> {
  await supabase.rpc("registrar_visualizacao", { p_request: id });
}

export async function decidir(versionId: string, decisao: "aprovado" | "alteracoes_solicitadas", comentario?: string) {
  const { data, error } = await supabase.rpc("decidir_versao", {
    p_version: versionId, p_decisao: decisao, p_comentario: comentario ?? null,
  });
  erro(error);
  return data as StatusSolicitacao;
}

export async function aprovarPendentes(requestId: string): Promise<number> {
  const { data, error } = await supabase.rpc("aprovar_pendentes", { p_request: requestId });
  erro(error);
  return data as number;
}

// ---------------- Decisões e comentários ----------------

export async function listarDecisoes(requestId: string): Promise<Decisao[]> {
  const { data, error } = await supabase.from("approvals").select("*")
    .eq("request_id", requestId).order("created_at");
  erro(error);
  return data ?? [];
}

export async function listarComentarios(requestId: string): Promise<Comentario[]> {
  const { data, error } = await supabase.from("comments").select("*")
    .eq("request_id", requestId).order("created_at");
  erro(error);
  return data ?? [];
}

export async function comentar(requestId: string, corpo: string, pieceId?: string | null): Promise<void> {
  const { error } = await supabase.from("comments").insert({
    request_id: requestId, piece_id: pieceId ?? null, corpo: corpo.trim(),
  });
  erro(error);
}

export async function aprovarSolicitacaoEmReuniao(id: string, quando: string, quem: string, observacao: string): Promise<void> {
  const { error } = await supabase.rpc("aprovar_solicitacao_em_reuniao", {
    p_request: id, p_reuniao_em: quando, p_aprovado_por: quem.trim(), p_observacao: observacao.trim() || null,
  });
  erro(error);
}
