// Montagem do orçamento por bloco de boleto (ex.: Geral, Revista): linhas
// agrupadas por projeto, subtotal por projeto com %, resumo por canal.
// Usado pela tabela do portal, pela imagem PNG e pelo e-mail dos P.I.s.
import { agruparPorProjeto, totais, type LinhaExibida } from "./orcamentos";
import type { BlocoVersao, LinhaOrcamento, PedidoInsercao, StatusVersaoOrcamento } from "../types";

export const BLOCO_PADRAO = "Geral";

/** Ordem dos canais nos resumos (os outros vêm depois, em ordem alfabética). */
const ORDEM_CANAIS = ["Google Ads", "Meta Ads", "LinkedIn Ads", "TikTok Ads"];

export function ordenarCanais(canais: Iterable<string>): string[] {
  const lista = [...new Set(canais)];
  const pos = (c: string) => {
    const i = ORDEM_CANAIS.indexOf(c);
    return i < 0 ? ORDEM_CANAIS.length : i;
  };
  return lista.sort((a, b) => pos(a) - pos(b) || a.localeCompare(b, "pt-BR"));
}

export interface CanalResumo { canal: string; valor: number; verba: number; imposto: number }

export interface LinhaDoBloco extends LinhaExibida {
  /** Nas linhas que abrem um projeto: total do projeto e % do bloco. */
  projetoValor: number;
  projetoPct: number;
}

export interface BlocoExibido {
  nome: string;
  /** Situação do bloco na versão (vazio se a versão ainda não tem o registro). */
  status: StatusVersaoOrcamento | null;
  info: BlocoVersao | undefined;
  linhas: LinhaOrcamento[];
  exibidas: LinhaDoBloco[];
  total: { valor: number; verba: number; imposto: number };
  /** Canais do bloco, na ordem padrão (só os que têm valor). */
  canais: CanalResumo[];
}

const centavos = (v: number) => Math.round(v * 100);

function resumoCanais(linhas: LinhaOrcamento[]): CanalResumo[] {
  const m = new Map<string, LinhaOrcamento[]>();
  for (const l of linhas) m.set(l.plataforma, [...(m.get(l.plataforma) ?? []), l]);
  return ordenarCanais(m.keys()).map((canal) => ({ canal, ...totais(m.get(canal)!) }));
}

/**
 * Blocos da versão, na ordem em que aparecem (pela primeira linha de cada
 * um). Os números dos canais seguem de um bloco para o outro.
 */
export function blocosDaVersao(linhas: LinhaOrcamento[], blocos: BlocoVersao[] = []): BlocoExibido[] {
  const ordenadas = [...linhas].sort((a, b) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at));
  const grupos = new Map<string, LinhaOrcamento[]>();
  for (const l of ordenadas) {
    const nome = l.bloco || BLOCO_PADRAO;
    grupos.set(nome, [...(grupos.get(nome) ?? []), l]);
  }
  let inicio = 1;
  return [...grupos].map(([nome, ls]) => {
    const total = totais(ls);
    const exibidas = agruparPorProjeto(ls, inicio).map((e, i, todas) => {
      if (!e.projetoSpan) return { ...e, projetoValor: 0, projetoPct: 0 };
      const doProjeto = todas.slice(i, i + e.projetoSpan).map((x) => x.linha);
      const valor = totais(doProjeto).valor;
      return { ...e, projetoValor: valor, projetoPct: total.valor ? (centavos(valor) / centavos(total.valor)) * 100 : 0 };
    });
    inicio += ls.length;
    const info = blocos.find((b) => b.bloco === nome);
    return { nome, status: info?.status ?? null, info, linhas: ls, exibidas, total, canais: resumoCanais(ls) };
  });
}

/** Mais de um bloco, ou um bloco com nome próprio: vale mostrar o nome. */
export const mostrarNomesDosBlocos = (blocos: BlocoExibido[]) =>
  blocos.length > 1 || (blocos[0] && blocos[0].nome !== BLOCO_PADRAO);

export const formatarPct = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** Blocos já usados no orçamento (para sugerir no formulário). */
export const blocosUsados = (linhas: LinhaOrcamento[]) =>
  [...new Set(linhas.map((l) => l.bloco || BLOCO_PADRAO))];

/**
 * Distribuição por bloco e canal dos P.I.s escolhidos (para o e-mail). P.I.
 * por canal usa o próprio valor; P.I. consolidado abre os canais pelas linhas
 * da versão de onde saiu.
 */
export function distribuicaoDosPIs(pis: PedidoInsercao[], linhasDaVersao: (versionId: string) => LinhaOrcamento[])
  : { bloco: string; canais: { canal: string; valor: number }[]; total: number }[] {
  const porBloco = new Map<string, Map<string, number>>();
  for (const p of pis) {
    const bloco = p.bloco || BLOCO_PADRAO;
    const m = porBloco.get(bloco) ?? new Map<string, number>();
    if (p.plataforma) {
      m.set(p.plataforma, (m.get(p.plataforma) ?? 0) + centavos(p.valor));
    } else {
      const ls = linhasDaVersao(p.version_id).filter((l) => (l.bloco || BLOCO_PADRAO) === bloco);
      // Sem as linhas da versão (ou se o valor não bate), fica a veiculação do próprio P.I.
      if (ls.length && ls.reduce((t, l) => t + centavos(l.valor), 0) === centavos(p.valor)) {
        for (const l of ls) m.set(l.plataforma, (m.get(l.plataforma) ?? 0) + centavos(l.valor));
      } else {
        m.set(p.veiculacao, (m.get(p.veiculacao) ?? 0) + centavos(p.valor));
      }
    }
    porBloco.set(bloco, m);
  }
  return [...porBloco].map(([bloco, m]) => {
    const canais = ordenarCanais(m.keys()).map((canal) => ({ canal, valor: m.get(canal)! / 100 }));
    return { bloco, canais, total: canais.reduce((s, c) => s + centavos(c.valor), 0) / 100 };
  });
}

export const STATUS_BLOCO: Record<StatusVersaoOrcamento, { rotulo: string; tom: "neutro" | "ok" | "atencao" | "alerta" | "info" }> = {
  rascunho: { rotulo: "Não enviado", tom: "neutro" },
  pendente: { rotulo: "Aguardando decisão", tom: "atencao" },
  aprovado: { rotulo: "Aprovado", tom: "ok" },
  alteracoes_solicitadas: { rotulo: "Ajuste pedido", tom: "alerta" },
  substituida: { rotulo: "Substituído", tom: "neutro" },
};

/** Cores dos canais (as mesmas da planilha da Atratis). */
export function corDoCanal(canal: string): { fundo: string; texto: string } {
  const c = canal.toLocaleLowerCase("pt-BR");
  if (c.includes("google")) return { fundo: "#F7931E", texto: "#232427" };
  if (c.includes("meta")) return { fundo: "#2ED3E6", texto: "#232427" };
  if (c.includes("linkedin")) return { fundo: "#6C8EF5", texto: "#ffffff" };
  if (c.includes("tiktok")) return { fundo: "#232427", texto: "#ffffff" };
  return { fundo: "#C9CDD4", texto: "#232427" };
}
