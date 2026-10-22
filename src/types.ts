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
