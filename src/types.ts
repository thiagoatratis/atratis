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
  /** "reuniao": registrada pela equipe depois de aprovação em reunião. */
  via?: "portal" | "reuniao";
  reuniao_em?: string | null;
  aprovado_por_cliente?: string | null;
  observacao_reuniao?: string | null;
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

// ---------------- Etapa 3: orçamentos ----------------

export type StatusOrcamento = StatusSolicitacao;
export type StatusVersaoOrcamento = "rascunho" | "pendente" | "aprovado" | "alteracoes_solicitadas" | "substituida";

export interface Orcamento {
  id: string;
  client_id: string;
  campaign_id: string | null;
  mes_referencia: string; // aaaa-mm-01
  titulo: string | null;
  instrucoes_cliente: string | null;
  responsavel_id: string | null;
  status: StatusOrcamento;
  enviado_em: string | null;
  visualizado_em: string | null;
  concluido_em: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type OrcamentoCampos = Pick<Orcamento,
  "client_id" | "campaign_id" | "mes_referencia" | "titulo" | "instrucoes_cliente" | "responsavel_id">;

export interface LinhaOrcamento {
  id: string;
  version_id: string;
  plataforma: string;
  descricao: string | null;
  valor: number;
  aliquota: number;
  imposto: number;
  verba: number;
  ordem: number;
  created_at: string;
}

export interface VersaoOrcamento {
  id: string;
  budget_id: string;
  numero: number;
  status: StatusVersaoOrcamento;
  observacao: string | null;
  enviado_em: string | null;
  decidido_em: string | null;
  created_at: string;
  linhas: LinhaOrcamento[];
}

export interface DecisaoOrcamento {
  id: number;
  version_id: string;
  budget_id: string;
  decisao: "aprovado" | "alteracoes_solicitadas";
  comentario: string | null;
  total: number;
  user_id: string | null;
  user_email: string | null;
  user_nome: string | null;
  /** "reuniao": registrada pela equipe depois de aprovação em reunião. */
  via?: "portal" | "reuniao";
  reuniao_em?: string | null;
  aprovado_por_cliente?: string | null;
  observacao_reuniao?: string | null;
  created_at: string;
}

/** Os status do orçamento são os mesmos da solicitação de criativos. */
export const STATUS_ORCAMENTO = STATUS_SOLICITACAO;

export const STATUS_VERSAO_ORCAMENTO: Record<StatusVersaoOrcamento, { rotulo: string; tom: "neutro" | "ok" | "atencao" | "alerta" | "info" }> = {
  rascunho: { rotulo: "Não enviada", tom: "neutro" },
  pendente: { rotulo: "Aguardando decisão", tom: "atencao" },
  aprovado: { rotulo: "Aprovada", tom: "ok" },
  alteracoes_solicitadas: { rotulo: "Alterações pedidas", tom: "alerta" },
  substituida: { rotulo: "Substituída", tom: "neutro" },
};

// ---------------- Etapa 4: Pedidos de Inserção ----------------

export interface DadosEmpresaPI {
  nome: string | null;
  razao_social: string | null;
  cnpj: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
}

export interface PedidoInsercao {
  id: string;
  numero: string;
  data_emissao: string;
  sequencia: number;
  budget_id: string;
  version_id: string;
  client_id: string;
  plataforma: string | null;
  veiculacao: string;
  valor: number;
  mes_referencia: string;
  campanha: string;
  periodo: string;
  prazo_pagamento: string;
  faturamento: "bruto" | "liquido";
  entrega_fatura: "agencia" | "cliente";
  observacoes: string | null;
  observacao_faturamento: string | null;
  dados_cliente: DadosEmpresaPI;
  dados_agencia: DadosEmpresaPI;
  pdf_path: string | null;
  status: "emitido" | "cancelado";
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
  created_by: string | null;
}

/** Campos que a equipe preenche (ou confirma) ao emitir. */
export interface CamposEmissaoPI {
  campanha: string;
  periodo: string;
  prazo_pagamento: string;
  faturamento: "bruto" | "liquido";
  entrega_fatura: "agencia" | "cliente";
  observacoes: string | null;
  observacao_faturamento: string | null;
}

// ---------------- Etapa 5: plano de comunicação ----------------

type Tom = "neutro" | "ok" | "atencao" | "alerta" | "info";

export type StatusPlano =
  | "rascunho" | "aguardando_aprovacao" | "em_analise" | "ajustes_solicitados"
  | "em_revisao_interna" | "aprovado" | "cancelado";
export type StatusVersaoPlano = "rascunho" | "pendente" | "concluida" | "substituida";
export type StatusSecaoPlano = "rascunho" | "pendente" | "aprovada" | "ajuste_solicitado" | "informativa";

export const STATUS_PLANO: Record<StatusPlano, { rotulo: string; rotuloCliente: string; tom: Tom }> = {
  rascunho: { rotulo: "Rascunho", rotuloCliente: "Rascunho", tom: "neutro" },
  aguardando_aprovacao: { rotulo: "Aguardando aprovação", rotuloCliente: "Aguardando sua aprovação", tom: "atencao" },
  em_analise: { rotulo: "Em análise pelo cliente", rotuloCliente: "Em análise", tom: "info" },
  ajustes_solicitados: { rotulo: "Ajustes solicitados", rotuloCliente: "Ajustes pedidos", tom: "alerta" },
  em_revisao_interna: { rotulo: "Em revisão interna", rotuloCliente: "Em ajuste pela Atratis", tom: "info" },
  aprovado: { rotulo: "Aprovado", rotuloCliente: "Aprovado", tom: "ok" },
  cancelado: { rotulo: "Cancelado", rotuloCliente: "Cancelado", tom: "neutro" },
};

export const STATUS_VERSAO_PLANO: Record<StatusVersaoPlano, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Não enviada", tom: "neutro" },
  pendente: { rotulo: "Com o cliente", tom: "atencao" },
  concluida: { rotulo: "Decidida", tom: "ok" },
  substituida: { rotulo: "Substituída", tom: "neutro" },
};

export const STATUS_SECAO: Record<StatusSecaoPlano, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Não enviada", tom: "neutro" },
  pendente: { rotulo: "Aguardando decisão", tom: "atencao" },
  aprovada: { rotulo: "Aprovada", tom: "ok" },
  ajuste_solicitado: { rotulo: "Ajuste pedido", tom: "alerta" },
  informativa: { rotulo: "Informativa", tom: "neutro" },
};

export interface Plano {
  id: string;
  client_id: string;
  titulo: string;
  instrucoes_cliente: string | null;
  responsavel_id: string | null;
  status: StatusPlano;
  enviado_em: string | null;
  visualizado_em: string | null;
  concluido_em: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type PlanoCampos = Pick<Plano, "client_id" | "titulo" | "instrucoes_cliente" | "responsavel_id">;

export interface SecaoPlano {
  id: string;
  version_id: string;
  ordem: number;
  nome: string;
  pagina_inicio: number;
  pagina_fim: number;
  requer_aprovacao: boolean;
  mantem_aprovacao_de: string | null;
  status: StatusSecaoPlano;
  decidido_em: string | null;
}

export interface VersaoPlano {
  id: string;
  plan_id: string;
  numero: number;
  status: StatusVersaoPlano;
  observacao: string | null;
  pdf_path: string | null;
  /** Apresentação publicada em atratis.com.br (abre no slide pelo #número). */
  link_url: string | null;
  /** Total de slides: do PDF ou informado junto com o link. */
  paginas: number | null;
  enviado_em: string | null;
  decidido_em: string | null;
  created_at: string;
  secoes: SecaoPlano[];
}

export interface DecisaoSecaoPlano {
  id: number;
  section_id: string;
  version_id: string;
  plan_id: string;
  secao_nome: string;
  decisao: "aprovada" | "ajuste_solicitado";
  comentario: string | null;
  slides: number[];
  user_id: string | null;
  user_email: string | null;
  user_nome: string | null;
  /** "reuniao": registrada pela equipe depois de aprovação em reunião. */
  via?: "portal" | "reuniao";
  reuniao_em?: string | null;
  aprovado_por_cliente?: string | null;
  observacao_reuniao?: string | null;
  created_at: string;
}

/** Mudança nos valores de um orçamento depois de enviado (histórico visível à equipe e ao cliente). */
export interface AlteracaoOrcamento {
  id: number;
  budget_id: string;
  version_id: string;
  acao: "incluida" | "alterada" | "removida";
  plataforma: string;
  descricao: string | null;
  plataforma_antes: string | null;
  descricao_antes: string | null;
  valor_antes: number | null;
  valor_depois: number | null;
  status_orcamento: StatusOrcamento;
  user_nome: string | null;
  user_email: string | null;
  created_at: string;
}

/** Envio de P.I.s por e-mail feito pelo sistema. */
export interface EnvioPI {
  id: number;
  budget_id: string;
  numeros: string[];
  para: string[];
  assunto: string;
  enviado_por_nome: string | null;
  created_at: string;
}
