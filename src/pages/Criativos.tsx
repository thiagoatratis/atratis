import { useMemo, useState } from "react";
import { LuPlus, LuSearch } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import { listarSolicitacoes } from "../lib/criativos";
import { useRouter } from "../lib/router";
import { formatarData, formatarDataHora } from "../lib/format";
import { AvisoErro, Botao, CabecalhoPagina, Carregando, Selo, Vazio } from "../components/ui";
import { STATUS_SOLICITACAO, type StatusSolicitacao } from "../types";
import { SolicitacaoFormulario } from "./SolicitacaoFormulario";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Grupo = "abertas" | "concluidas" | "todas";
const ABERTAS: StatusSolicitacao[] = ["rascunho", "aguardando_aprovacao", "em_analise", "alteracoes_solicitadas", "em_revisao_interna"];

export function Criativos() {
  const { navigate } = useRouter();
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<Grupo>("abertas");
  const [cliente, setCliente] = useState("");
  const [status, setStatus] = useState<"" | StatusSolicitacao>("");
  const [responsavel, setResponsavel] = useState("");

  const dados = useAsync(async () => {
    const [solicitacoes, clientes, usuarios] = await Promise.all([listarSolicitacoes(), listarClientes(), listarUsuarios()]);
    return { solicitacoes, clientes, usuarios };
  }, []);

  const nomes = useMemo(() => ({
    cliente: new Map((dados.data?.clientes ?? []).map((c) => [c.id, c.nome_comercial])),
    pessoa: new Map((dados.data?.usuarios ?? []).map((u) => [u.id, u.nome || u.email])),
  }), [dados.data]);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados.data?.solicitacoes ?? []).filter((s) => {
      if (grupo === "abertas" && !ABERTAS.includes(s.status)) return false;
      if (grupo === "concluidas" && ABERTAS.includes(s.status)) return false;
      if (cliente && s.client_id !== cliente) return false;
      if (status && s.status !== status) return false;
      if (responsavel && s.responsavel_id !== responsavel) return false;
      return !q || normalizar(`${s.titulo} ${nomes.cliente.get(s.client_id) ?? ""}`).includes(q);
    });
  }, [dados.data, busca, grupo, cliente, status, responsavel, nomes]);

  const equipe = (dados.data?.usuarios ?? []).filter((u) => u.role !== "cliente");

  return (
    <>
      <CabecalhoPagina
        titulo="Criativos"
        descricao="Peças enviadas para o cliente aprovar."
        acoes={<Botao variante="primario" onClick={() => setNova(true)}><LuPlus /> Nova solicitação</Botao>}
      />
      <div className="barra-filtros">
        <label className="busca">
          <LuSearch aria-hidden />
          <span className="sr">Buscar</span>
          <input type="search" placeholder="Buscar por título ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <div className="segmentado" role="group" aria-label="Situação">
          {(["abertas", "concluidas", "todas"] as Grupo[]).map((g) => (
            <button key={g} className={grupo === g ? "on" : ""} aria-pressed={grupo === g} onClick={() => { setGrupo(g); setStatus(""); }}>
              {g === "abertas" ? "Em andamento" : g === "concluidas" ? "Concluídas" : "Todas"}
            </button>
          ))}
        </div>
      </div>
      <div className="barra-filtros filtros-secundarios">
        <select aria-label="Filtrar por cliente" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {dados.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
        </select>
        <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value as StatusSolicitacao | "")}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_SOLICITACAO) as StatusSolicitacao[]).map((k) => <option key={k} value={k}>{STATUS_SOLICITACAO[k].rotulo}</option>)}
        </select>
        <select aria-label="Filtrar por responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {equipe.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
        </select>
      </div>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> :
        !dados.data?.solicitacoes.length ? (
          <Vazio titulo="Nenhuma solicitação ainda" acao={<Botao variante="primario" onClick={() => setNova(true)}>Criar a primeira</Botao>}>
            Monte uma solicitação, adicione as peças e envie para o cliente aprovar.
          </Vazio>
        ) : !lista.length ? (
          <Vazio titulo="Nada encontrado">Mude a busca ou os filtros.</Vazio>
        ) : (
          <div className="tabela-moldura">
            <table className="tabela tabela-clicavel">
              <thead>
                <tr>
                  <th>Solicitação</th>
                  <th className="col-opcional">Canais</th>
                  <th className="col-opcional">Responsável</th>
                  <th className="col-opcional">Enviada</th>
                  <th className="col-opcional">Atualizada</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => {
                  const canais = [...new Set(s.pecas.filter((p) => p.ativo).map((p) => p.canal))];
                  const st = STATUS_SOLICITACAO[s.status];
                  return (
                    <tr key={s.id} onClick={() => navigate(`/criativos/${s.id}`)}>
                      <td>
                        <a href={`/criativos/${s.id}`} onClick={(e) => e.preventDefault()} className="celula-titulo">{s.titulo}</a>
                        <span className="celula-sub">{nomes.cliente.get(s.client_id)}</span>
                      </td>
                      <td className="col-opcional">{canais.join(", ") || <span className="falta">Sem peças</span>}</td>
                      <td className="col-opcional">{s.responsavel_id ? nomes.pessoa.get(s.responsavel_id) : <span className="falta">Ninguém</span>}</td>
                      <td className="col-opcional tab-num">{s.enviado_em ? formatarData(s.enviado_em) : <span className="falta">Não enviada</span>}</td>
                      <td className="col-opcional tab-num">{formatarDataHora(s.updated_at)}</td>
                      <td><Selo tom={st.tom}>{st.rotulo}</Selo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <SolicitacaoFormulario
        aberto={nova}
        clienteInicial={cliente || undefined}
        onFechar={() => setNova(false)}
        onSalvo={(id) => { setNova(false); navigate(`/criativos/${id}`); }}
      />
    </>
  );
}
