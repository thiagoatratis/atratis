import { LuPencil, LuTrash2 } from "react-icons/lu";
import { formatarAliquota, formatarMoeda } from "../lib/dinheiro";
import { totais } from "../lib/orcamentos";
import type { LinhaOrcamento } from "../types";

/**
 * Linhas do orçamento. O valor de cada linha é o do boleto; a coluna
 * "Para anúncios" e o imposto (só Meta Ads, 12,15% por dentro) vêm do banco.
 */
export function TabelaOrcamento({ linhas, onEditar, onExcluir }: {
  linhas: LinhaOrcamento[];
  onEditar?: (l: LinhaOrcamento) => void;
  onExcluir?: (l: LinhaOrcamento) => void;
}) {
  const t = totais(linhas);
  const acoes = !!(onEditar || onExcluir);
  const temImposto = linhas.some((l) => l.aliquota > 0);
  return (
    <div className="orcamento">
      <div className="tabela-moldura">
        <table className="tabela tabela-orcamento">
          <thead>
            <tr>
              <th>Plataforma</th>
              <th className="num col-opcional">Para anúncios</th>
              <th className="num col-opcional">Imposto</th>
              <th className="num">Valor</th>
              {acoes && <th><span className="sr">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td>
                  <span className="celula-titulo">{l.plataforma}</span>
                  {l.descricao && <span className="celula-sub">{l.descricao}</span>}
                </td>
                <td className="num tab-num col-opcional">{formatarMoeda(l.verba)}</td>
                <td className="num tab-num col-opcional">
                  {l.aliquota > 0 ? <>{formatarMoeda(l.imposto)} <small className="suave">({formatarAliquota(l.aliquota)})</small></> : <span className="suave">—</span>}
                </td>
                <td className="num tab-num"><strong>{formatarMoeda(l.valor)}</strong></td>
                {acoes && (
                  <td className="acoes-linha">
                    {onEditar && <button type="button" className="icone-btn" onClick={() => onEditar(l)} aria-label={`Editar ${l.plataforma}`}><LuPencil /></button>}
                    {onExcluir && <button type="button" className="icone-btn" onClick={() => onExcluir(l)} aria-label={`Excluir ${l.plataforma}`}><LuTrash2 /></button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Total</th>
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
          <div className="resumo-total"><dt>Total a pagar</dt><dd className="tab-num">{formatarMoeda(t.valor)}</dd></div>
        </dl>
      )}
    </div>
  );
}
