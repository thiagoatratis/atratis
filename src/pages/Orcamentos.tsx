import { useMemo, useState } from "react";
import { LuPlus, LuSearch } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes } from "../lib/api";
import { listarOrcamentos, tituloOrcamento, totais } from "../lib/orcamentos";
import { useRouter } from "../lib/router";
import { formatarMes, formatarMoeda } from "../lib/dinheiro";
import { AvisoErro, Botao, CabecalhoPagina, Carregando, Selo, Vazio } from "../components/ui";
import { STATUS_ORCAMENTO, type StatusOrcamento } from "../types";
import { OrcamentoFormulario } from "./OrcamentoFormulario";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Grupo = "abertos" | "concluidos" | "todos";
const ABERTOS: StatusOrcamento[] = ["rascunho", "aguardando_aprovacao", "em_analise", "alteracoes_solicitadas", "em_revisao_interna"];

export function Orcamentos() {
  const { navigate } = useRouter();
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<Grupo>("abertos");
  const [cliente, setCliente] = useState("");
  const [status, setStatus] = useState<"" | StatusOrcamento>("");

  const dados = useAsync(async () => {
    const [orcamentos, clientes] = await Promise.all([listarOrcamentos(), listarClientes()]);
    return { orcamentos, clientes };
  }, []);

  const nomeCliente = useMemo(
    () => new Map((dados.data?.clientes ?? []).map((c) => [c.id, c.nome_comercial])), [dados.data]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados.data?.orcamentos ?? []).filter((o) => {
      if (grupo === "abertos" && !ABERTOS.includes(o.status)) return false;
      if (grupo === "concluidos" && ABERTOS.includes(o.status)) return false;
      if (cliente && o.client_id !== cliente) return false;
      if (status && o.status !== status) return false;
      return !q || normalizar(`${tituloOrcamento(o)} ${formatarMes(o.mes_referencia)} ${nomeCliente.get(o.client_id) ?? ""}`).includes(q);
    });
  }, [dados.data, busca, grupo, cliente, status, nomeCliente]);

  return (
    <>
      <CabecalhoPagina
        titulo="Orçamentos"
        descricao="Verba de mídia do mês, por plataforma, para o cliente aprovar."
        acoes={<Botao variante="primario" onClick={() => setNovo(true)}><LuPlus /> Novo orçamento</Botao>}
      />
      <div className="barra-filtros">
        <label className="busca">
          <LuSearch aria-hidden />
          <span className="sr">Buscar</span>
          <input type="search" placeholder="Buscar por cliente, mês ou título" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <div className="segmentado" role="group" aria-label="Situação">
          {(["abertos", "concluidos", "todos"] as Grupo[]).map((g) => (
            <button key={g} className={grupo === g ? "on" : ""} aria-pressed={grupo === g} onClick={() => { setGrupo(g); setStatus(""); }}>
              {g === "abertos" ? "Em andamento" : g === "concluidos" ? "Concluídos" : "Todos"}
            </button>
          ))}
        </div>
      </div>
      <div className="barra-filtros filtros-secundarios">
        <select aria-label="Filtrar por cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {dados.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
        </select>
        <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value as StatusOrcamento | "")}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_ORCAMENTO) as StatusOrcamento[]).map((k) => <option key={k} value={k}>{STATUS_ORCAMENTO[k].rotulo}</option>)}
        </select>
      </div>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> :
        !dados.data?.orcamentos.length ? (
          <Vazio titulo="Nenhum orçamento ainda" acao={<Botao variante="primario" onClick={() => setNovo(true)}>Criar o primeiro</Botao>}>
            Monte o orçamento do mês com os valores de cada plataforma e envie para o cliente aprovar.
          </Vazio>
        ) : !lista.length ? (
          <Vazio titulo="Nada encontrado">Mude a busca ou os filtros.</Vazio>
        ) : (
          <div className="tabela-moldura">
            <table className="tabela tabela-clicavel">
              <thead>
                <tr>
                  <th>Orçamento</th>
                  <th className="col-opcional">Plataformas</th>
                  <th className="col-opcional">Versão</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((o) => {
                  const atual = o.versoes[o.versoes.length - 1];
                  const plataformas = [...new Set((atual?.linhas ?? []).map((l) => l.plataforma))];
                  const st = STATUS_ORCAMENTO[o.status];
                  return (
                    <tr key={o.id} onClick={() => navigate(`/orcamentos/${o.id}`)}>
                      <td>
                        <a href={`/orcamentos/${o.id}`} onClick={(e) => e.preventDefault()} className="celula-titulo">{tituloOrcamento(o)}</a>
                        <span className="celula-sub">{nomeCliente.get(o.client_id)}{o.titulo ? `, ${formatarMes(o.mes_referencia)}` : ""}</span>
                      </td>
                      <td className="col-opcional">{plataformas.join(", ") || <span className="falta">Sem valores</span>}</td>
                      <td className="col-opcional tab-num">{atual ? atual.numero : ""}</td>
                      <td className="num tab-num">{formatarMoeda(totais(atual?.linhas ?? []).valor)}</td>
                      <td><Selo tom={st.tom}>{st.rotulo}</Selo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <OrcamentoFormulario
        aberto={novo}
        clienteInicial={cliente || undefined}
        onFechar={() => setNovo(false)}
        onSalvo={(id) => { setNovo(false); navigate(`/orcamentos/${id}`); }}
      />
    </>
  );
}
