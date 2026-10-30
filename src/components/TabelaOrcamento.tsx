import type { ReactNode } from "react";
import { LuPencil, LuTrash2 } from "react-icons/lu";
import { formatarMoeda } from "../lib/dinheiro";
import { totais } from "../lib/orcamentos";
import {
  STATUS_BLOCO, blocosDaVersao, corDoCanal, formatarPct, mostrarNomesDosBlocos, type BlocoExibido,
} from "../lib/blocos";
import { Selo } from "./ui";
import type { BlocoVersao, LinhaOrcamento } from "../types";

/**
 * Orçamento no formato da planilha "Verba × Projeto × Objetivo": uma tabela
 * por bloco de boleto (projeto agrupado, canais numerados, objetivo agrupado,
 * investimento por projeto e % do bloco) e, ao lado, o resumo por canal com
 * o valor para anúncios e o imposto do Meta Ads (já incluso no valor).
 */
export function TabelaOrcamento({ linhas, blocos, onEditar, onExcluir, mostrarStatus = true, rodapeBloco }: {
  linhas: LinhaOrcamento[];
  blocos?: BlocoVersao[];
  onEditar?: (l: LinhaOrcamento) => void;
  onExcluir?: (l: LinhaOrcamento) => void;
  /** Mostra a situação de cada bloco (aprovado, aguardando...). */
  mostrarStatus?: boolean;
  /** Conteúdo embaixo de cada bloco (ex.: botões de aprovar do cliente). */
  rodapeBloco?: (b: BlocoExibido) => ReactNode;
}) {
  const exibidos = blocosDaVersao(linhas, blocos);
  const comNomes = mostrarNomesDosBlocos(exibidos);
  const geral = totais(linhas);
  if (!exibidos.length) return null;
  return (
    <div className="orcamento-blocos">
      {exibidos.map((b) => (
        <section key={b.nome} className="bloco-orcamento" aria-label={comNomes ? `Bloco ${b.nome}` : "Valores"}>
          {comNomes && (
            <header className="bloco-topo">
              <h3>{b.nome}</h3>
              {mostrarStatus && b.status && <Selo tom={STATUS_BLOCO[b.status].tom}>{STATUS_BLOCO[b.status].rotulo}</Selo>}
              <span className="bloco-total tab-num">{formatarMoeda(b.total.valor)}</span>
            </header>
          )}
          <div className="bloco-corpo">
            <TabelaBloco bloco={b} onEditar={onEditar} onExcluir={onExcluir} />
            <ResumoCanais bloco={b} titulo={comNomes ? `Por canal · ${b.nome}` : "Por canal"} />
          </div>
          {rodapeBloco?.(b)}
        </section>
      ))}
      {comNomes && exibidos.length > 1 && (
        <p className="total-geral">
          Total de todos os blocos: <strong className="tab-num">{formatarMoeda(geral.valor)}</strong>
          <span className="suave"> ({exibidos.map((b) => `${b.nome} ${formatarMoeda(b.total.valor)}`).join(" + ")})</span>
        </p>
      )}
    </div>
  );
}

function TabelaBloco({ bloco: b, onEditar, onExcluir }: {
  bloco: BlocoExibido;
  onEditar?: (l: LinhaOrcamento) => void;
  onExcluir?: (l: LinhaOrcamento) => void;
}) {
  const acoes = !!(onEditar || onExcluir);
  return (
    <div className="tabela-moldura">
      <table className="tabela tabela-projetos">
        <caption className="sr">Projetos, canais, objetivos e investimento{b.nome ? ` do bloco ${b.nome}` : ""}</caption>
        <thead>
          <tr>
            <th scope="col" className="centro">Projeto</th>
            <th scope="col" className="col-numero"><span className="sr">Número</span></th>
            <th scope="col">Canal</th>
            <th scope="col" className="centro">Objetivo</th>
            <th scope="col" className="num">Por campanha</th>
            <th scope="col" className="num">Por projeto</th>
            <th scope="col" className="num">% do bloco</th>
            {acoes && <th scope="col"><span className="sr">Ações</span></th>}
          </tr>
        </thead>
        <tbody>
          {b.exibidas.map(({ linha: l, numero, projetoSpan, objetivoSpan, projetoValor, projetoPct }) => (
            <tr key={l.id} className={projetoSpan ? "inicio-projeto" : undefined}>
              {projetoSpan > 0 && (
                <th scope="rowgroup" rowSpan={projetoSpan} className="celula-projeto">
                  {l.projeto || <span className="suave">Sem projeto</span>}
                </th>
              )}
              <td className="col-numero"><span className="numero-canal">{numero}</span></td>
              <td className="celula-canal">{l.plataforma}</td>
              {objetivoSpan > 0 && (
                <td rowSpan={objetivoSpan} className="celula-objetivo">{l.descricao || <span className="suave">—</span>}</td>
              )}
              <td className="num tab-num">{formatarMoeda(l.valor)}</td>
              {projetoSpan > 0 && (
                <>
                  <td rowSpan={projetoSpan} className="num tab-num celula-agrupada"><strong>{formatarMoeda(projetoValor)}</strong></td>
                  <td rowSpan={projetoSpan} className="num tab-num celula-agrupada">{formatarPct(projetoPct)}</td>
                </>
              )}
              {acoes && (
                <td className="acoes-linha">
                  {onEditar && <button type="button" className="icone-btn" onClick={() => onEditar(l)} aria-label={`Editar a linha ${numero}, ${l.plataforma}`}><LuPencil /></button>}
                  {onExcluir && <button type="button" className="icone-btn" onClick={() => onExcluir(l)} aria-label={`Excluir a linha ${numero}, ${l.plataforma}`}><LuTrash2 /></button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4}>Investimento total</th>
            <td className="num tab-num">{formatarMoeda(b.total.valor)}</td>
            <td className="num tab-num"><strong>{formatarMoeda(b.total.valor)}</strong></td>
            <td className="num tab-num">100%</td>
            {acoes && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ResumoCanais({ bloco: b, titulo }: { bloco: BlocoExibido; titulo: string }) {
  return (
    <aside className="resumo-canais" aria-label={titulo}>
      <h4>{titulo}</h4>
      <ul>
        {b.canais.map((c) => (
          <li key={c.canal}>
            <span className="canal-cor" style={{ background: corDoCanal(c.canal).fundo }} aria-hidden />
            <span className="canal-nome">{c.canal}</span>
            <span className="tab-num">{formatarMoeda(c.valor)}</span>
          </li>
        ))}
        <li className="canal-total"><span className="canal-nome">Total</span><span className="tab-num">{formatarMoeda(b.total.valor)}</span></li>
      </ul>
      <dl>
        <div><dt>Para anúncios</dt><dd className="tab-num">{formatarMoeda(b.total.verba)}</dd></div>
        {b.total.imposto > 0 && <div><dt>Imposto Meta Ads (já incluso)</dt><dd className="tab-num">{formatarMoeda(b.total.imposto)}</dd></div>}
      </dl>
    </aside>
  );
}
