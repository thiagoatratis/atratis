import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import { listarSolicitacoes } from "../lib/criativos";
import { listarOrcamentos, tituloOrcamento, totais } from "../lib/orcamentos";
import { contagemSecoes, listarPlanos } from "../lib/planos";
import { formatarMoeda } from "../lib/dinheiro";
import { useAuth } from "../lib/auth";
import { useRouter } from "../lib/router";
import { formatarData } from "../lib/format";
import { AvisoErro, Carregando, Selo } from "../components/ui";
import { STATUS_PLANO, STATUS_SOLICITACAO, type StatusPlano, type StatusSolicitacao } from "../types";

/** Item do portal: solicitação de criativos, orçamento ou plano de comunicação. */
interface Item {
  chave: string;
  caminho: string;
  tipo: "Criativos" | "Orçamento" | "Plano";
  titulo: string;
  clientId: string;
  status: StatusSolicitacao | StatusPlano;
  selo: { rotuloCliente: string; tom: "neutro" | "ok" | "atencao" | "alerta" | "info" };
  detalhe: string;
  data: string;
}

const aguardando = (s: StatusSolicitacao | StatusPlano) => s === "aguardando_aprovacao" || s === "em_analise";

export function Portal() {
  const { perfil } = useAuth();
  const { navigate } = useRouter();
  const dados = useAsync(async () => {
    const [empresas, vinculos, solicitacoes, orcamentos, planos] = await Promise.all([
      listarClientes(), listarVinculos(), listarSolicitacoes(), listarOrcamentos(), listarPlanos(),
    ]);
    const meus = new Map(vinculos.filter((v) => v.user_id === perfil?.id).map((v) => [v.client_id, v]));
    const itens: Item[] = [
      ...solicitacoes.map((s): Item => ({
        chave: `s-${s.id}`, caminho: `/aprovacoes/${s.id}`, tipo: "Criativos", titulo: s.titulo, clientId: s.client_id,
        status: s.status, selo: STATUS_SOLICITACAO[s.status], data: s.enviado_em ?? s.updated_at,
        detalhe: s.prazo_aprovacao && aguardando(s.status) ? `Aprovar até ${formatarData(s.prazo_aprovacao)}` : `Enviada em ${formatarData(s.enviado_em)}`,
      })),
      ...orcamentos.map((o): Item => ({
        chave: `o-${o.id}`, caminho: `/orcamentos/${o.id}`, tipo: "Orçamento", titulo: tituloOrcamento(o), clientId: o.client_id,
        status: o.status, selo: STATUS_SOLICITACAO[o.status], data: o.enviado_em ?? o.updated_at,
        detalhe: `${formatarMoeda(totais(o.versoes.at(-1)?.linhas ?? []).valor)}. Enviado em ${formatarData(o.enviado_em)}`,
      })),
      ...planos.map((pl): Item => {
        const c = contagemSecoes(pl.versoes.at(-1));
        return {
          chave: `p-${pl.id}`, caminho: `/planos/${pl.id}`, tipo: "Plano", titulo: pl.titulo, clientId: pl.client_id,
          status: pl.status, selo: STATUS_PLANO[pl.status], data: pl.enviado_em ?? pl.updated_at,
          detalhe: aguardando(pl.status) && c.pendentes
            ? `${c.pendentes} de ${c.total} ${c.total === 1 ? "seção" : "seções"} para decidir`
            : `Enviado em ${formatarData(pl.enviado_em)}`,
        };
      }),
    ].sort((a, b) => b.data.localeCompare(a.data));
    return {
      empresas: empresas.map((c) => ({ ...c, podeAprovar: meus.get(c.id)?.pode_aprovar ?? false })),
      itens,
    };
  }, [perfil?.id]);

  const primeiroNome = perfil?.nome?.split(" ")[0];
  const nomeEmpresa = (id: string) => dados.data?.empresas.find((e) => e.id === id)?.nome_comercial;
  const abertas = (dados.data?.itens ?? []).filter((i) => aguardando(i.status));
  const outras = (dados.data?.itens ?? []).filter((i) => !aguardando(i.status));
  const variasEmpresas = (dados.data?.empresas.length ?? 0) > 1;

  const Linha = ({ i }: { i: Item }) => {
    const st = i.selo;
    return (
      <li>
        <button type="button" className="portal-item" onClick={() => navigate(i.caminho)}>
          <span className="portal-item-texto">
            <span className="portal-tipo">{i.tipo}</span>
            <strong>{i.titulo}</strong>
            <span>{variasEmpresas ? `${nomeEmpresa(i.clientId)}. ` : ""}{i.detalhe}</span>
          </span>
          <Selo tom={st.tom}>{st.rotuloCliente}</Selo>
        </button>
      </li>
    );
  };

  return (
    <>
      <section className="portal-boas-vindas">
        <h1>{primeiroNome ? `Olá, ${primeiroNome}.` : "Olá."}</h1>
        <p>Aqui você aprova os criativos, orçamentos e planos que a Atratis prepara para a sua empresa.</p>
      </section>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> : (
        <>
          <section className="portal-bloco" aria-labelledby="pendentes">
            <h2 id="pendentes">Aguardando você</h2>
            {abertas.length ? (
              <ul className="portal-lista">{abertas.map((i) => <Linha key={i.chave} i={i} />)}</ul>
            ) : (
              <div className="portal-vazio">
                <p className="vazio-titulo">Nada para aprovar agora</p>
                <p>Quando a Atratis enviar um material ou orçamento para a sua aprovação, ele aparece aqui.</p>
              </div>
            )}
          </section>

          {outras.length > 0 && (
            <section className="portal-bloco" aria-labelledby="anteriores">
              <h2 id="anteriores">Já decididas e em andamento</h2>
              <ul className="portal-lista">{outras.map((i) => <Linha key={i.chave} i={i} />)}</ul>
            </section>
          )}

          <section className="portal-bloco" aria-labelledby="empresas">
            <h2 id="empresas">{dados.data!.empresas.length === 1 ? "Sua empresa" : "Suas empresas"}</h2>
            {!dados.data!.empresas.length ? (
              <p className="suave">Seu acesso ainda não está ligado a nenhuma empresa ativa. Fale com o seu contato na Atratis.</p>
            ) : (
              <ul className="portal-empresas">
                {dados.data!.empresas.map((c) => (
                  <li key={c.id}>
                    <strong>{c.nome_comercial}</strong>
                    <span>{c.podeAprovar ? "Você pode aprovar" : "Você acompanha, sem aprovar"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
