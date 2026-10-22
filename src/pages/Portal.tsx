import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AvisoErro, Carregando } from "../components/ui";

export function Portal() {
  const { perfil } = useAuth();
  const dados = useAsync(async () => {
    const [empresas, vinculos] = await Promise.all([listarClientes(), listarVinculos()]);
    const meus = new Map(vinculos.filter((v) => v.user_id === perfil?.id).map((v) => [v.client_id, v]));
    return empresas.map((c) => ({ ...c, podeAprovar: meus.get(c.id)?.pode_aprovar ?? false }));
  }, [perfil?.id]);

  const primeiroNome = perfil?.nome?.split(" ")[0];

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
            <div className="portal-vazio">
              <p className="vazio-titulo">Nada para aprovar agora</p>
              <p>Quando a Atratis enviar um material ou orçamento para a sua aprovação, ele aparece aqui.</p>
            </div>
          </section>

          <section className="portal-bloco" aria-labelledby="empresas">
            <h2 id="empresas">{dados.data!.length === 1 ? "Sua empresa" : "Suas empresas"}</h2>
            {!dados.data!.length ? (
              <p className="suave">
                Seu acesso ainda não está ligado a nenhuma empresa ativa. Fale com o seu contato na Atratis.
              </p>
            ) : (
              <ul className="portal-empresas">
                {dados.data!.map((c) => (
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
