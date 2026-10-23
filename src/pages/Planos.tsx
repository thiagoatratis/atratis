import { useMemo, useState } from "react";
import { LuPlus, LuSearch } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes } from "../lib/api";
import { contagemSecoes, listarPlanos } from "../lib/planos";
import { useRouter } from "../lib/router";
import { formatarData } from "../lib/format";
import { AvisoErro, Botao, CabecalhoPagina, Carregando, Selo, Vazio } from "../components/ui";
import { STATUS_PLANO, type StatusPlano } from "../types";
import { PlanoFormulario } from "./PlanoFormulario";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Grupo = "abertos" | "concluidos" | "todos";
const ABERTOS: StatusPlano[] = ["rascunho", "aguardando_aprovacao", "em_analise", "ajustes_solicitados", "em_revisao_interna"];

export function Planos() {
  const { navigate } = useRouter();
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<Grupo>("abertos");
  const [cliente, setCliente] = useState("");

  const dados = useAsync(async () => {
    const [planos, clientes] = await Promise.all([listarPlanos(), listarClientes()]);
    return { planos, clientes };
  }, []);

  const nomeCliente = useMemo(
    () => new Map((dados.data?.clientes ?? []).map((c) => [c.id, c.nome_comercial])), [dados.data]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados.data?.planos ?? []).filter((p) => {
      if (grupo === "abertos" && !ABERTOS.includes(p.status)) return false;
      if (grupo === "concluidos" && ABERTOS.includes(p.status)) return false;
      if (cliente && p.client_id !== cliente) return false;
      return !q || normalizar(`${p.titulo} ${nomeCliente.get(p.client_id) ?? ""}`).includes(q);
    });
  }, [dados.data, busca, grupo, cliente, nomeCliente]);

  return (
    <>
      <CabecalhoPagina
        titulo="Planos"
        descricao="Plano de comunicação feito no Claude Design, aprovado pelo cliente seção por seção."
        acoes={<Botao variante="primario" onClick={() => setNovo(true)}><LuPlus /> Novo plano</Botao>}
      />
      <div className="barra-filtros">
        <label className="busca">
          <LuSearch aria-hidden />
          <span className="sr">Buscar</span>
          <input type="search" placeholder="Buscar por cliente ou título" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <div className="segmentado" role="group" aria-label="Situação">
          {(["abertos", "concluidos", "todos"] as Grupo[]).map((g) => (
            <button key={g} className={grupo === g ? "on" : ""} aria-pressed={grupo === g} onClick={() => setGrupo(g)}>
              {g === "abertos" ? "Em andamento" : g === "concluidos" ? "Concluídos" : "Todos"}
            </button>
          ))}
        </div>
        <select aria-label="Filtrar por cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {dados.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
        </select>
      </div>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> :
        !dados.data?.planos.length ? (
          <Vazio titulo="Nenhum plano ainda" acao={<Botao variante="primario" onClick={() => setNovo(true)}>Criar o primeiro</Botao>}>
            Exporte o plano do Claude Design em PDF, suba aqui, marque as seções e envie para o cliente aprovar cada uma.
          </Vazio>
        ) : !lista.length ? (
          <Vazio titulo="Nada encontrado">Mude a busca ou os filtros.</Vazio>
        ) : (
          <div className="tabela-moldura">
            <table className="tabela tabela-clicavel">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th className="col-opcional">Versão</th>
                  <th className="col-opcional">Seções</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const atual = p.versoes.at(-1);
                  const c = contagemSecoes(atual);
                  const st = STATUS_PLANO[p.status];
                  return (
                    <tr key={p.id} onClick={() => navigate(`/planos/${p.id}`)}>
                      <td>
                        <a href={`/planos/${p.id}`} onClick={(e) => e.preventDefault()} className="celula-titulo">{p.titulo}</a>
                        <span className="celula-sub">
                          {nomeCliente.get(p.client_id)}{p.enviado_em ? `, enviado em ${formatarData(p.enviado_em)}` : ""}
                        </span>
                      </td>
                      <td className="col-opcional tab-num">{atual?.numero ?? ""}</td>
                      <td className="col-opcional">
                        {!atual?.pdf_path ? <span className="falta">Sem PDF</span>
                          : !c.total ? <span className="falta">Seções não marcadas</span>
                          : atual.status === "rascunho" ? `${c.total} para aprovar`
                          : `${c.aprovadas} de ${c.total} aprovadas${c.ajustes ? `, ${c.ajustes} com ajuste` : ""}`}
                      </td>
                      <td><Selo tom={st.tom}>{st.rotulo}</Selo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <PlanoFormulario
        aberto={novo}
        clienteInicial={cliente || undefined}
        onFechar={() => setNovo(false)}
        onSalvo={(id) => { setNovo(false); navigate(`/planos/${id}`); }}
      />
    </>
  );
}
