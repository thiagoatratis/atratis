// Transforma eventos da auditoria em frases legíveis.
import type { EventoAuditoria, Profile } from "../types";
import { PERFIL_ROTULO } from "../types";
import { formatarCEP, formatarCNPJ } from "./format";

const CAMPOS: Record<string, string> = {
  nome_comercial: "nome comercial",
  razao_social: "razão social",
  cnpj: "CNPJ",
  endereco: "endereço",
  bairro: "bairro",
  cidade: "cidade",
  uf: "UF",
  cep: "CEP",
  telefone: "telefone",
  email_contato: "e-mail de contato",
  email: "e-mail",
  ativo: "situação",
  nome: "nome",
  role: "perfil",
  pode_aprovar: "permissão de aprovar",
  observacoes_internas: "observações internas",
};

function valor(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (campo === "ativo") return v ? "ativo" : "inativo";
  if (campo === "pode_aprovar") return v ? "pode aprovar" : "só visualiza";
  if (campo === "role" && typeof v === "string" && v in PERFIL_ROTULO) return PERFIL_ROTULO[v as keyof typeof PERFIL_ROTULO];
  if (campo === "cnpj") return formatarCNPJ(String(v));
  if (campo === "cep") return formatarCEP(String(v));
  if (campo === "observacoes_internas") return "texto atualizado";
  return String(v);
}

export interface Linha { titulo: string; detalhes: string[] }

export function descrever(e: EventoAuditoria, pessoas: Map<string, Pick<Profile, "email" | "nome">>): Linha {
  const reg = (e.details?.registro ?? {}) as Record<string, unknown>;
  const alt = (e.details?.alteracoes ?? {}) as Record<string, { de: unknown; para: unknown }>;
  const pessoa = (id: unknown) => {
    const p = typeof id === "string" ? pessoas.get(id) : undefined;
    return p ? p.nome || p.email : "usuário removido";
  };
  const mudancas = Object.entries(alt).map(([k, { de, para }]) =>
    k === "observacoes_internas"
      ? "Observações internas atualizadas"
      : `${(CAMPOS[k] ?? k).replace(/^./, (c) => c.toUpperCase())}: ${valor(k, de)} → ${valor(k, para)}`,
  );

  switch (e.action) {
    case "cliente.criado":
      return { titulo: `Cliente cadastrado: ${String(reg.nome_comercial ?? "")}`, detalhes: [] };
    case "cliente.alterado":
      return { titulo: "Cadastro do cliente alterado", detalhes: mudancas };
    case "cliente.observacoes.criado":
    case "cliente.observacoes.alterado":
      return { titulo: "Observações internas atualizadas", detalhes: [] };
    case "cliente.aprovador.criado":
      return {
        titulo: `Acesso liberado para ${pessoa(reg.user_id)}`,
        detalhes: [reg.pode_aprovar ? "Pode aprovar" : "Só visualiza"],
      };
    case "cliente.aprovador.alterado":
      return { titulo: `Acesso de ${pessoa(e.entity_id?.split(":")[1])} alterado`, detalhes: mudancas };
    case "cliente.aprovador.removido":
      return { titulo: `Acesso de ${pessoa(reg.user_id)} removido`, detalhes: [] };
    case "cliente.acesso_equipe.criado":
      return { titulo: `${pessoa(reg.user_id)} passou a acompanhar este cliente`, detalhes: [] };
    case "cliente.acesso_equipe.removido":
      return { titulo: `${pessoa(reg.user_id)} deixou de acompanhar este cliente`, detalhes: [] };
    case "usuario.criado":
      return { titulo: `Usuário criado: ${String(reg.email ?? "")}`, detalhes: [valor("role", reg.role)] };
    case "usuario.convidado":
      return { titulo: `Convite: ${String((e.details as Record<string, unknown>).email ?? pessoa(e.entity_id))}`, detalhes: [] };
    case "usuario.alterado":
      return { titulo: `Usuário alterado: ${pessoa(e.entity_id)}`, detalhes: mudancas };
    case "usuario.link_enviado":
      return { titulo: `Link de acesso enviado para ${pessoa(e.entity_id)}`, detalhes: [] };
    case "agencia.criado":
    case "agencia.alterado":
      return { titulo: "Dados da agência alterados", detalhes: mudancas };
    default:
      return { titulo: e.action, detalhes: mudancas };
  }
}
