// Acesso a dados. Toda permissão é conferida no banco (RLS) e na função de
// servidor; aqui só montamos as consultas e traduzimos erros.
import { FunctionsHttpError, type PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  AcessoEquipe, Agencia, Cliente, ClienteCampos, EventoAuditoria, Perfil, Profile, Vinculo,
} from "../types";

export class ErroApp extends Error {
  constructor(message: string, public detalhes?: Record<string, unknown>) {
    super(message);
  }
}

function traduzir(e: PostgrestError | null): never | void {
  if (!e) return;
  if (e.code === "23505") throw new ErroApp("Já existe um cadastro com esse nome.");
  if (e.code === "23514") throw new ErroApp(e.message.includes("check constraint") ? "Algum campo está em formato inválido." : e.message);
  if (e.code === "42501") throw new ErroApp(e.message.startsWith("new row") ? "Você não tem permissão para essa ação." : e.message);
  throw new ErroApp(e.message);
}

const PERFIL_CAMPOS = "id, email, nome, ativo, role";

// ---------------- Clientes ----------------

export async function listarClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase.from("clients").select("*").order("nome_comercial");
  traduzir(error);
  return data ?? [];
}

export async function obterCliente(id: string): Promise<Cliente | null> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  traduzir(error);
  return data;
}

export async function criarCliente(campos: ClienteCampos): Promise<Cliente> {
  const { data, error } = await supabase.from("clients").insert(campos).select().single();
  traduzir(error);
  return data as Cliente;
}

export async function atualizarCliente(id: string, campos: Partial<ClienteCampos>): Promise<Cliente> {
  const { data, error } = await supabase.from("clients").update(campos).eq("id", id).select().maybeSingle();
  traduzir(error);
  if (!data) throw new ErroApp("Você não tem permissão para alterar este cliente.");
  return data as Cliente;
}

export async function obterObservacoes(clientId: string): Promise<string> {
  const { data, error } = await supabase
    .from("client_internal").select("observacoes_internas").eq("client_id", clientId).maybeSingle();
  traduzir(error);
  return data?.observacoes_internas ?? "";
}

export async function salvarObservacoes(clientId: string, texto: string): Promise<void> {
  const { error } = await supabase
    .from("client_internal")
    .upsert({ client_id: clientId, observacoes_internas: texto.trim() || null }, { onConflict: "client_id" });
  traduzir(error);
}

// ---------------- Vínculos ----------------

export async function listarVinculos(clientId?: string): Promise<Vinculo[]> {
  let q = supabase
    .from("client_members")
    .select(`client_id, user_id, pode_aprovar, ativo, created_at, profile:profiles!client_members_user_id_fkey(${PERFIL_CAMPOS})`);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  traduzir(error);
  return (data ?? []) as unknown as Vinculo[];
}

export async function vincularAprovador(clientId: string, userId: string, podeAprovar: boolean) {
  const { error } = await supabase
    .from("client_members").insert({ client_id: clientId, user_id: userId, pode_aprovar: podeAprovar });
  traduzir(error);
}

export async function alterarVinculo(clientId: string, userId: string, campos: { pode_aprovar?: boolean; ativo?: boolean }) {
  const { error } = await supabase
    .from("client_members").update(campos).eq("client_id", clientId).eq("user_id", userId);
  traduzir(error);
}

export async function removerVinculo(clientId: string, userId: string) {
  const { error } = await supabase
    .from("client_members").delete().eq("client_id", clientId).eq("user_id", userId);
  traduzir(error);
}

export async function listarAcessosEquipe(clientId?: string): Promise<AcessoEquipe[]> {
  let q = supabase
    .from("staff_client_access")
    .select(`user_id, client_id, created_at, profile:profiles!staff_client_access_user_id_fkey(${PERFIL_CAMPOS})`);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  traduzir(error);
  return (data ?? []) as unknown as AcessoEquipe[];
}

export async function liberarAcessoEquipe(clientId: string, userId: string) {
  const { error } = await supabase.from("staff_client_access").insert({ client_id: clientId, user_id: userId });
  traduzir(error);
}

export async function removerAcessoEquipe(clientId: string, userId: string) {
  const { error } = await supabase
    .from("staff_client_access").delete().eq("client_id", clientId).eq("user_id", userId);
  traduzir(error);
}

// ---------------- Usuários ----------------

export async function listarUsuarios(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("*").order("nome", { nullsFirst: false });
  traduzir(error);
  return data ?? [];
}

export async function buscarUsuarioPorEmail(email: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  traduzir(error);
  return data;
}

export async function atualizarMeuNome(id: string, nome: string) {
  const { error } = await supabase.from("profiles").update({ nome: nome.trim() || null }).eq("id", id);
  traduzir(error);
}

async function chamarAdminUsuarios<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body: corpo });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const resp = await error.context.json().catch(() => null);
      throw new ErroApp(resp?.erro ?? "A função de usuários recusou a operação.", resp ?? undefined);
    }
    throw new ErroApp("Não foi possível falar com a função de usuários. Confira se ela foi publicada no Supabase.");
  }
  return data as T;
}

export interface ResultadoConvite { user_id: string; link_enviado: boolean; avisos: string[] }

export function convidarUsuario(dados: {
  email: string; nome: string; perfil: Perfil;
  empresas?: { client_id: string; pode_aprovar: boolean }[];
  clientes_equipe?: string[];
  enviar_link: boolean;
}) {
  return chamarAdminUsuarios<ResultadoConvite>({
    acao: "convidar", ...dados, redirect_to: `${window.location.origin}/`,
  });
}

export function atualizarUsuario(userId: string, campos: { nome?: string; perfil?: Perfil; ativo?: boolean }) {
  return chamarAdminUsuarios<{ ok: boolean; avisos?: string[] }>({ acao: "atualizar", user_id: userId, ...campos });
}

export function enviarLinkAcesso(userId: string) {
  return chamarAdminUsuarios<{ ok: boolean }>({
    acao: "enviar_link", user_id: userId, redirect_to: `${window.location.origin}/`,
  });
}

/**
 * Link de acesso pessoal para mandar pelo WhatsApp: entra sem e-mail, uma vez,
 * dentro do prazo configurado no Supabase. Só o link mais recente da pessoa vale.
 */
export function gerarLinkAcesso(userId: string, destino: string) {
  return chamarAdminUsuarios<{ link: string; nome: string }>({
    acao: "link_acesso", user_id: userId, destino, base: window.location.origin,
  });
}

// ---------------- Agência ----------------

export async function obterAgencia(): Promise<Agencia | null> {
  const { data, error } = await supabase.from("agency_settings").select("*").maybeSingle();
  traduzir(error);
  return data;
}

export async function salvarAgencia(campos: Partial<Omit<Agencia, "id" | "updated_at" | "updated_by">>) {
  const { data, error } = await supabase.from("agency_settings").update(campos).eq("id", true).select().maybeSingle();
  traduzir(error);
  if (!data) throw new ErroApp("Somente administradores alteram os dados da agência.");
  return data as Agencia;
}

// ---------------- Auditoria ----------------

export async function historicoCliente(clientId: string, limite = 100): Promise<EventoAuditoria[]> {
  const { data, error } = await supabase
    .from("audit_log").select("*").eq("client_id", clientId)
    .order("occurred_at", { ascending: false }).limit(limite);
  traduzir(error);
  return data ?? [];
}

export async function historicoGeral(limite = 200): Promise<EventoAuditoria[]> {
  const { data, error } = await supabase
    .from("audit_log").select("*").order("occurred_at", { ascending: false }).limit(limite);
  traduzir(error);
  return data ?? [];
}
