import { LuPencil, LuTrash2 } from "react-icons/lu";
import { formatarAliquota, formatarMoeda } from "../lib/dinheiro";
import { agruparPorProjeto, totais } from "../lib/orcamentos";
import type { LinhaOrcamento } from "../types";

/**
 * Linhas do orçamento no formato "Projetos × Objetivo × Mídias": projeto
 * agrupado, canais numerados, objetivo agrupado quando se repete em
 * sequência. O valor de cada linha é a verba fixa mensal (o boleto); a
 * coluna "Para anúncios" e o imposto (só Meta Ads, 12,15% por dentro) vêm
 * do banco.
 */
export function TabelaOrcamento({ linhas, onEditar, onExcluir }: {
  linhas: LinhaOrcamento[];
  onEditar?: (l: LinhaOrcamento) => void;
  onExcluir?: (l: LinhaOrcamento) => void;
}) {
  const t = totais(linhas);
  const acoes = !!(onEditar || onExcluir);
  const temImposto = linhas.some((l) => l.aliquota > 0);
  const exibidas = agruparPorProjeto(linhas);
  return (
    <div className="orcamento">
      <div className="tabela-moldura">
        <table className="tabela tabela-orcamento tabela-projetos">
          <caption className="sr">Projetos, canais, objetivos e verba fixa mensal</caption>
          <thead>
            <tr>
              <th scope="col" className="centro">Projeto</th>
              <th scope="col" className="col-numero"><span className="sr">Número</span></th>
              <th scope="col">Canal</th>
              <th scope="col" className="centro">Objetivo</th>
              <th scope="col" className="num col-opcional">Para anúncios</th>
              <th scope="col" className="num col-opcional">Imposto</th>
              <th scope="col" className="num">Verba fixa mensal</th>
              {acoes && <th scope="col"><span className="sr">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {exibidas.map(({ linha: l, numero, projetoSpan, objetivoSpan }) => (
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
                <td className="num tab-num col-opcional">{formatarMoeda(l.verba)}</td>
                <td className="num tab-num col-opcional">
                  {l.aliquota > 0 ? <>{formatarMoeda(l.imposto)}<small className="suave aliquota">{formatarAliquota(l.aliquota)}</small></> : <span className="suave">—</span>}
                </td>
                <td className="num tab-num"><strong>{formatarMoeda(l.valor)}</strong></td>
                {acoes && (
                  <td className="acoes-linha">
                    {onEditar && <button type="button" className="icone-btn" onClick={() => onEditar(l)} aria-label={`Editar a linha ${numero}, ${l.plataforma}`}><LuPencil /></button>}
                    {onExcluir && <button type="button" className="icone-btn" onClick={() => onExcluir(l)} aria-label={`Excluir a linha ${numero}, ${l.plataforma}`}><LuTrash2 /></button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>Verba fixa geral / mensal</th>
                <td className="num tab-num col-opcional">{formatarMoeda(t.verba)}</td>
                <td className="num tab-num col-opcional">{formatarMoeda(t.imposto)}</td>
                <td className="num tab-num"><strong>{formatarMoeda(t.valor)}</strong></td>
                {acoes && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {linhas.length > 0 && (
        <dl className="resumo-valores">
          <div><dt>Para anúncios</dt><dd className="tab-num">{formatarMoeda(t.verba)}</dd></div>
          {temImposto && <div><dt>Imposto Meta Ads, já incluso</dt><dd className="tab-num">{formatarMoeda(t.imposto)}</dd></div>}
          <div className="resumo-total"><dt>Verba fixa geral / mensal</dt><dd className="tab-num">{formatarMoeda(t.valor)}</dd></div>
        </dl>
      )}
    </div>
  );
}
