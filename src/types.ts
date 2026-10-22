export type Perfil = "admin" | "equipe" | "cliente";

export const PERFIL_ROTULO: Record<Perfil, string> = {
  admin: "Administrador",
  equipe: "Equipe interna",
  cliente: "Cliente",
};

export interface Profile {
  id: string;
  email: string;
  nome: string | null;
  role: Perfil;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Cliente {
  id: string;
  nome_comercial: string;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email_contato: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type ClienteCampos = Omit<Cliente, "id" | "created_at" | "updated_at" | "created_by">;

export interface Vinculo {
  client_id: string;
  user_id: string;
  pode_aprovar: boolean;
  ativo: boolean;
  created_at: string;
  profile?: Pick<Profile, "id" | "email" | "nome" | "ativo" | "role"> | null;
}

export interface AcessoEquipe {
  user_id: string;
  client_id: string;
  created_at: string;
  profile?: Pick<Profile, "id" | "email" | "nome" | "ativo" | "role"> | null;
}

export interface Agencia {
  id: true;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface EventoAuditoria {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  client_id: string | null;
  details: Record<string, unknown>;
}

// ---------------- Etapa 2: criativos ----------------

export type StatusSolicitacao =
  | "rascunho" | "aguardando_aprovacao" | "em_analise" | "alteracoes_solicitadas"
  | "em_revisao_interna" | "aprovado" | "cancelado";

export type StatusVersao = "rascunho" | "pendente" | "aprovado" | "alteracoes_solicitadas";

export interface Campanha {
  id: string;
  client_id: string;
  nome: string;
  objetivo: string | null;
  ativo: boolean;
}

export interface Solicitacao {
  id: string;
  client_id: string;
  campaign_id: string | null;
  titulo: string;
  objetivo: string | null;
  veiculacao_inicio: string | null;
  veiculacao_fim: string | null;
  prazo_aprovacao: string | null;
  responsavel_id: string | null;
  instrucoes_cliente: string | null;
  status: StatusSolicitacao;
  enviado_em: string | null;
  visualizado_em: string | null;
  concluido_em: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type SolicitacaoCampos = Pick<Solicitacao,
  "client_id" | "campaign_id" | "titulo" | "objetivo" | "veiculacao_inicio" | "veiculacao_fim"
  | "prazo_aprovacao" | "responsavel_id" | "instrucoes_cliente">;

export interface Versao {
  id: string;
  piece_id: string;
  numero: number;
  parent_version_id: string | null;
  tipo: "arquivo" | "link";
  storage_path: string | null;
  nome_arquivo: string | null;
  mime_type: string | null;
  tamanho_bytes: number | null;
  link_url: string | null;
  observacao: string | null;
  status: StatusVersao;
  enviado_em: string | null;
  decidido_em: string | null;
  created_at: string;
}

export interface Peca {
  id: string;
  request_id: string;
  nome: string;
  canal: string;
  formato: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
  created_at: string;
  versoes: Versao[];
}

export interface Decisao {
  id: number;
  version_id: string;
  piece_id: string;
  request_id: string;
  decisao: "aprovado" | "alteracoes_solicitadas";
  comentario: string | null;
  user_id: string | null;
  user_email: string | null;
  user_nome: string | null;
  created_at: string;
}

export interface Comentario {
  id: number;
  request_id: string;
  piece_id: string | null;
  autor_id: string;
  autor_nome: string | null;
  autor_papel: Perfil | null;
  corpo: string;
  created_at: string;
}

export const STATUS_SOLICITACAO: Record<StatusSolicitacao, { rotulo: string; rotuloCliente: string; tom: "neutro" | "ok" | "atencao" | "alerta" | "info" }> = {
  rascunho: { rotulo: "Rascunho", rotuloCliente: "Rascunho", tom: "neutro" },
  aguardando_aprovacao: { rotulo: "Aguardando aprovação", rotuloCliente: "Aguardando sua aprovação", tom: "atencao" },
  em_analise: { rotulo: "Em análise pelo cliente", rotuloCliente: "Em análise", tom: "info" },
  alteracoes_solicitadas: { rotulo: "Alterações solicitadas", rotuloCliente: "Alterações pedidas", tom: "alerta" },
  em_revisao_interna: { rotulo: "Em revisão interna", rotuloCliente: "Em ajuste pela Atratis", tom: "info" },
  aprovado: { rotulo: "Aprovado", rotuloCliente: "Aprovado", tom: "ok" },
  cancelado: { rotulo: "Cancelado", rotuloCliente: "Cancelado", tom: "neutro" },
};

export const STATUS_VERSAO: Record<StatusVersao, { rotulo: string; tom: "neutro" | "ok" | "atencao" | "alerta" | "info" }> = {
  rascunho: { rotulo: "Não enviada", tom: "neutro" },
  pendente: { rotulo: "Aguardando decisão", tom: "atencao" },
  aprovado: { rotulo: "Aprovada", tom: "ok" },
  alteracoes_solicitadas: { rotulo: "Alterações pedidas", tom: "alerta" },
};
