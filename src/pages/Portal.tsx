import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import { listarSolicitacoes } from "../lib/criativos";
import { useAuth } from "../lib/auth";
import { useRouter } from "../lib/router";
import { formatarData } from "../lib/format";
import { AvisoErro, Carregando, Selo } from "../components/ui";
import { STATUS_SOLICITACAO, type Solicitacao } from "../types";

export function Portal() {
  const { perfil } = useAuth();
  const { navigate } = useRouter();
  const dados = useAsync(async () => {
    const [empresas, vinculos, solicitacoes] = await Promise.all([listarClientes(), listarVinculos(), listarSolicitacoes()]);
    const meus = new Map(vinculos.filter((v) => v.user_id === perfil?.id).map((v) => [v.client_id, v]));
    return {
      empresas: empresas.map((c) => ({ ...c, podeAprovar: meus.get(c.id)?.pode_aprovar ?? false })),
      solicitacoes,
    };
  }, [perfil?.id]);

  const primeiroNome = perfil?.nome?.split(" ")[0];
  const nomeEmpresa = (id: string) => dados.data?.empresas.find((e) => e.id === id)?.nome_comercial;
  const abertas = (dados.data?.solicitacoes ?? []).filter((s) => s.status === "aguardando_aprovacao" || s.status === "em_analise");
  const outras = (dados.data?.solicitacoes ?? []).filter((s) => !abertas.includes(s));
  const variasEmpresas = (dados.data?.empresas.length ?? 0) > 1;

  const Linha = ({ s }: { s: Solicitacao }) => {
    const st = STATUS_SOLICITACAO[s.status];
    return (
      <li>
        <button type="button" className="portal-item" onClick={() => navigate(`/aprovacoes/${s.id}`)}>
          <span className="portal-item-texto">
            <strong>{s.titulo}</strong>
            <span>
              {variasEmpresas ? `${nomeEmpresa(s.client_id)}. ` : ""}
              {s.prazo_aprovacao && (s.status === "aguardando_aprovacao" || s.status === "em_analise")
                ? `Aprovar até ${formatarData(s.prazo_aprovacao)}` : `Enviada em ${formatarData(s.enviado_em)}`}
            </span>
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
        <p>Aqui você aprova os criativos e orçamentos que a Atratis prepara para a sua empresa.</p>
      </section>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> : (
        <>
          <section className="portal-bloco" aria-labelledby="pendentes">
            <h2 id="pendentes">Aguardando você</h2>
            {abertas.length ? (
              <ul className="portal-lista">{abertas.map((s) => <Linha key={s.id} s={s} />)}</ul>
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
              <ul className="portal-lista">{outras.map((s) => <Linha key={s.id} s={s} />)}</ul>
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
