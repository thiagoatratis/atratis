import { useMemo, useState } from "react";
import { LuPlus, LuSearch } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRouter } from "../lib/router";
import { formatarCNPJ } from "../lib/format";
import { AvisoErro, Botao, CabecalhoPagina, Carregando, Selo, Vazio, useAviso } from "../components/ui";
import { ClienteFormulario } from "./ClienteFormulario";

type Filtro = "ativos" | "inativos" | "todos";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Clientes() {
  const { perfil } = useAuth();
  const { navigate } = useRouter();
  const avisar = useAviso();
  const admin = perfil?.role === "admin";
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("ativos");
  const [novo, setNovo] = useState(false);

  const dados = useAsync(async () => {
    const [clientes, vinculos] = await Promise.all([listarClientes(), listarVinculos()]);
    const aprovadores = new Map<string, number>();
    for (const v of vinculos) {
      if (v.ativo && v.pode_aprovar && v.profile?.ativo) {
        aprovadores.set(v.client_id, (aprovadores.get(v.client_id) ?? 0) + 1);
      }
    }
    return { clientes, aprovadores };
  }, []);

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados.data?.clientes ?? []).filter((c) => {
      if (filtro === "ativos" && !c.ativo) return false;
      if (filtro === "inativos" && c.ativo) return false;
      if (!q) return true;
      return [c.nome_comercial, c.razao_social, c.cnpj, c.cidade].some((v) => v && normalizar(v).includes(q));
    });
  }, [dados.data, busca, filtro]);

  return (
    <>
      <CabecalhoPagina
        titulo="Clientes"
        descricao={admin
          ? "Cadastro das empresas e de quem aprova por cada uma."
          : "Clientes que você acompanha."}
        acoes={admin && (
          <Botao variante="primario" onClick={() => setNovo(true)}>
            <LuPlus /> Novo cliente
          </Botao>
        )}
      />

      <div className="barra-filtros">
        <label className="busca">
          <LuSearch aria-hidden />
          <span className="sr">Buscar cliente</span>
          <input
            type="search"
            placeholder="Buscar por nome, razão social, CNPJ ou cidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <div className="segmentado" role="group" aria-label="Situação">
          {(["ativos", "inativos", "todos"] as Filtro[]).map((f) => (
            <button key={f} className={filtro === f ? "on" : ""} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
              {f === "ativos" ? "Ativos" : f === "inativos" ? "Inativos" : "Todos"}
            </button>
          ))}
        </div>
      </div>

      {dados.loading && !dados.data ? (
        <Carregando />
      ) : dados.error ? (
        <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />
      ) : !dados.data?.clientes.length ? (
        <Vazio titulo={admin ? "Nenhum cliente cadastrado" : "Nenhum cliente liberado para você"}
          acao={admin && <Botao variante="primario" onClick={() => setNovo(true)}>Cadastrar o primeiro cliente</Botao>}>
          {!admin && "Peça a um administrador para liberar o acesso aos clientes que você atende."}
        </Vazio>
      ) : !lista.length ? (
        <Vazio titulo="Nenhum cliente encontrado">Tente outro termo ou mude o filtro de situação.</Vazio>
      ) : (
        <div className="tabela-moldura">
          <table className="tabela tabela-clicavel">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="col-opcional">CNPJ</th>
                <th className="col-opcional">Cidade</th>
                <th className="num">Aprovadores</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const n = dados.data?.aprovadores.get(c.id) ?? 0;
                return (
                  <tr key={c.id} onClick={() => navigate(`/clientes/${c.id}`)}>
                    <td>
                      <a href={`/clientes/${c.id}`} onClick={(e) => { e.preventDefault(); }} className="celula-titulo">
                        {c.nome_comercial}
                      </a>
                      {c.razao_social && <span className="celula-sub">{c.razao_social}</span>}
                    </td>
                    <td className="tab-num col-opcional">{c.cnpj ? formatarCNPJ(c.cnpj) : <span className="falta">Não informado</span>}</td>
                    <td className="col-opcional">{c.cidade ? `${c.cidade}${c.uf ? ` - ${c.uf}` : ""}` : <span className="falta">Não informada</span>}</td>
                    <td className="num">{n || <span className="falta">Nenhum</span>}</td>
                    <td>{c.ativo ? <Selo tom="ok">Ativo</Selo> : <Selo>Inativo</Selo>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {admin && (
        <ClienteFormulario
          aberto={novo}
          onFechar={() => setNovo(false)}
          onSalvo={(c) => {
            setNovo(false);
            avisar(`${c.nome_comercial} cadastrado.`);
            navigate(`/clientes/${c.id}`);
          }}
        />
      )}
    </>
  );
}
