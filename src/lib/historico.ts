// Transforma eventos da auditoria em frases legíveis.
import type { EventoAuditoria, Profile } from "../types";
import { slidesCitados } from "./planos";
import { PERFIL_ROTULO } from "../types";
import { formatarCEP, formatarCNPJ } from "./format";
import { formatarMes, formatarMoeda } from "./dinheiro";

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
  titulo: "título",
  objetivo: "objetivo",
  veiculacao_inicio: "início da veiculação",
  veiculacao_fim: "fim da veiculação",
  prazo_aprovacao: "prazo de aprovação",
  instrucoes_cliente: "instruções ao cliente",
  responsavel_id: "responsável",
  campaign_id: "campanha",
  canal: "canal",
  formato: "formato",
  descricao: "descrição",
  link_url: "link",
  mes_referencia: "mês de referência",
  plataforma: "plataforma",
  valor: "valor",
};

function valor(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (campo === "ativo") return v ? "ativo" : "inativo";
  if (campo === "pode_aprovar") return v ? "pode aprovar" : "só visualiza";
  if (campo === "role" && typeof v === "string" && v in PERFIL_ROTULO) return PERFIL_ROTULO[v as keyof typeof PERFIL_ROTULO];
  if (campo === "cnpj") return formatarCNPJ(String(v));
  if (campo === "cep") return formatarCEP(String(v));
  if (campo === "observacoes_internas" || campo === "instrucoes_cliente" || campo === "descricao") return "texto atualizado";
  if (campo.endsWith("_id")) return "outro valor";
  if (campo === "mes_referencia") return formatarMes(String(v));
  if (campo === "valor" && !Number.isNaN(Number(v))) return formatarMoeda(Number(v));
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v).split("-").reverse().join("/");
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
    case "campanha.criado":
      return { titulo: `Campanha criada: ${String(reg.nome ?? "")}`, detalhes: [] };
    case "campanha.alterado":
      return { titulo: "Campanha alterada", detalhes: mudancas };
    case "solicitacao.criado":
      return { titulo: `Solicitação de criativos criada: ${String(reg.titulo ?? "")}`, detalhes: [] };
    case "solicitacao.alterado": {
      const st = alt.status?.para as string | undefined;
      const frases: Record<string, string> = {
        aguardando_aprovacao: "Solicitação enviada ao cliente",
        em_analise: "Cliente abriu a solicitação",
        alteracoes_solicitadas: "Cliente pediu alterações",
        em_revisao_interna: "Solicitação voltou para revisão interna",
        aprovado: "Solicitação aprovada pelo cliente",
        cancelado: "Solicitação cancelada",
      };
      if (st && frases[st]) return { titulo: frases[st], detalhes: mudancas.filter((m) => !/^Status|^Enviado|^Visualizado|^Concluido|^Cancelado/i.test(m)) };
      return { titulo: "Dados da solicitação alterados", detalhes: mudancas };
    }
    case "solicitacao.observacoes.criado":
    case "solicitacao.observacoes.alterado":
      return { titulo: "Observações internas da solicitação atualizadas", detalhes: [] };
    case "peca.criado":
      return { titulo: `Peça adicionada: ${String(reg.nome ?? "")}`, detalhes: [`${String(reg.canal ?? "")}, ${String(reg.formato ?? "")}`] };
    case "peca.alterado":
      return { titulo: alt.ativo?.para === false ? "Peça retirada da aprovação" : "Peça alterada", detalhes: alt.ativo ? [] : mudancas };
    case "peca.removido":
      return { titulo: `Peça excluída: ${String(reg.nome ?? "")}`, detalhes: [] };
    case "versao.criado":
      return { titulo: `Versão ${String(reg.numero ?? "")} adicionada`, detalhes: reg.observacao ? [String(reg.observacao)] : [] };
    case "versao.alterado": {
      const st = alt.status?.para as string | undefined;
      if (st === "pendente") return { titulo: "Versão enviada ao cliente", detalhes: [] };
      if (st === "aprovado" || st === "alteracoes_solicitadas") return { titulo: "Versão decidida pelo cliente", detalhes: [] };
      return { titulo: "Versão alterada", detalhes: mudancas };
    }
    case "versao.removido":
      return { titulo: "Versão em rascunho descartada", detalhes: [] };
    case "decisao.criado":
      return {
        titulo: reg.decisao === "aprovado" ? `Peça aprovada por ${String(reg.user_nome || reg.user_email || "cliente")}` : `Alteração pedida por ${String(reg.user_nome || reg.user_email || "cliente")}`,
        detalhes: reg.comentario ? [`"${String(reg.comentario)}"`] : [],
      };
    case "orcamento.criado":
      return { titulo: `Orçamento criado: ${formatarMes(String(reg.mes_referencia ?? ""))}${reg.titulo ? ` (${String(reg.titulo)})` : ""}`, detalhes: [] };
    case "orcamento.alterado": {
      const st = alt.status?.para as string | undefined;
      const frases: Record<string, string> = {
        aguardando_aprovacao: "Orçamento enviado ao cliente",
        em_analise: "Cliente abriu o orçamento",
        alteracoes_solicitadas: "Cliente pediu alterações no orçamento",
        em_revisao_interna: "Orçamento voltou para revisão interna",
        aprovado: "Orçamento aprovado pelo cliente",
        cancelado: "Orçamento cancelado",
      };
      if (st && frases[st]) return { titulo: frases[st], detalhes: mudancas.filter((m) => !/^Status|^Enviado|^Visualizado|^Concluido|^Cancelado/i.test(m)) };
      return { titulo: "Dados do orçamento alterados", detalhes: mudancas };
    }
    case "orcamento.observacoes.criado":
    case "orcamento.observacoes.alterado":
      return { titulo: "Observações internas do orçamento atualizadas", detalhes: [] };
    case "orcamento.versao.criado":
      return { titulo: `Versão ${String(reg.numero ?? "")} do orçamento criada`, detalhes: reg.observacao ? [String(reg.observacao)] : [] };
    case "orcamento.versao.alterado": {
      const st = alt.status?.para as string | undefined;
      if (st === "pendente") return { titulo: "Versão do orçamento enviada ao cliente", detalhes: [] };
      if (st === "substituida") return { titulo: "Versão do orçamento substituída antes da decisão", detalhes: [] };
      if (st === "aprovado" || st === "alteracoes_solicitadas") return { titulo: "Versão do orçamento decidida pelo cliente", detalhes: [] };
      return { titulo: "Versão do orçamento alterada", detalhes: mudancas };
    }
    case "orcamento.linha.criado":
      return { titulo: `Linha adicionada: ${String(reg.plataforma ?? "")}${reg.descricao ? `, ${String(reg.descricao)}` : ""}`, detalhes: [valor("valor", reg.valor)] };
    case "orcamento.linha.alterado":
      return { titulo: "Linha do orçamento alterada", detalhes: mudancas.filter((m) => !/^Imposto|^Verba|^Aliquota|^Ordem/i.test(m)) };
    case "orcamento.linha.removido":
      return { titulo: `Linha removida: ${String(reg.plataforma ?? "")}${reg.descricao ? `, ${String(reg.descricao)}` : ""}`, detalhes: [valor("valor", reg.valor)] };
    case "orcamento.decisao.criado":
      return {
        titulo: reg.decisao === "aprovado"
          ? `Orçamento aprovado por ${String(reg.user_nome || reg.user_email || "cliente")}`
          : `Alteração no orçamento pedida por ${String(reg.user_nome || reg.user_email || "cliente")}`,
        detalhes: [`Total ${valor("valor", reg.total)}`, ...(reg.comentario ? [`"${String(reg.comentario)}"`] : [])],
      };
    case "pi.criado":
      return {
        titulo: `P.I. ${String(reg.numero ?? "")} emitido`,
        detalhes: [`${String(reg.veiculacao ?? "")}, ${valor("valor", reg.valor)}`],
      };
    case "pi.alterado":
      if (alt.status?.para === "cancelado") return { titulo: "P.I. cancelado", detalhes: [] };
      if (alt.pdf_path) return { titulo: "PDF do P.I. gerado", detalhes: [] };
      return { titulo: "P.I. alterado", detalhes: [] };
    case "plano.criado":
      return { titulo: `Plano criado: ${String(reg.titulo ?? "")}`, detalhes: [] };
    case "plano.alterado": {
      const st = alt.status?.para as string | undefined;
      const frases: Record<string, string> = {
        aguardando_aprovacao: "Plano enviado ao cliente",
        em_analise: "Cliente abriu o plano",
        ajustes_solicitados: "Cliente pediu ajustes no plano",
        em_revisao_interna: "Plano voltou para revisão interna",
        aprovado: "Plano aprovado pelo cliente",
        cancelado: "Plano cancelado",
      };
      if (st && frases[st]) return { titulo: frases[st], detalhes: mudancas.filter((m) => !/^Status|^Enviado|^Visualizado|^Concluido|^Cancelado/i.test(m)) };
      return { titulo: "Dados do plano alterados", detalhes: mudancas };
    }
    case "plano.versao.criado":
      return { titulo: `Versão ${String(reg.numero ?? "")} do plano criada`, detalhes: reg.observacao ? [String(reg.observacao)] : [] };
    case "plano.versao.alterado": {
      const st = alt.status?.para as string | undefined;
      if (st === "pendente") return { titulo: "Versão do plano enviada ao cliente", detalhes: [] };
      if (st === "substituida") return { titulo: "Versão do plano substituída antes de o cliente terminar", detalhes: [] };
      if (st === "concluida") return { titulo: "Cliente terminou de decidir as seções do plano", detalhes: [] };
      if (alt.pdf_path) return { titulo: `PDF do plano enviado (${String(alt.paginas?.para ?? "")} slides)`, detalhes: [] };
      return { titulo: "Versão do plano alterada", detalhes: mudancas.filter((m) => !/^Pdf/i.test(m)) };
    }
    case "plano.decisao.criado": {
      const slides = Array.isArray(reg.slides) && reg.slides.length ? ` (${slidesCitados(reg.slides as number[])})` : "";
      return {
        titulo: reg.decisao === "aprovada"
          ? `Seção "${String(reg.secao_nome ?? "")}" aprovada por ${String(reg.user_nome || reg.user_email || "cliente")}`
          : `Ajuste na seção "${String(reg.secao_nome ?? "")}" pedido por ${String(reg.user_nome || reg.user_email || "cliente")}${slides}`,
        detalhes: reg.comentario ? [`"${String(reg.comentario)}"`] : [],
      };
    }
    case "comentario.criado":
      return { titulo: `Comentário de ${String(reg.autor_nome ?? "")}`, detalhes: [String(reg.corpo ?? "").slice(0, 280)] };
    default:
      return { titulo: e.action, detalhes: mudancas };
  }
}
