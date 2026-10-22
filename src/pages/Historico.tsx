import { useMemo } from "react";
import { useAsync } from "../lib/useAsync";
import { historicoGeral, listarClientes, listarUsuarios } from "../lib/api";
import { AvisoErro, CabecalhoPagina, Carregando } from "../components/ui";
import { ListaHistorico } from "../components/ListaHistorico";

export function Historico() {
  const dados = useAsync(async () => {
    const [eventos, pessoas, clientes] = await Promise.all([historicoGeral(300), listarUsuarios(), listarClientes()]);
    return { eventos, pessoas, clientes };
  }, []);
  const nomes = useMemo(() => new Map((dados.data?.clientes ?? []).map((c) => [c.id, c.nome_comercial])), [dados.data]);

  return (
    <>
      <CabecalhoPagina
        titulo="Histórico"
        descricao="Tudo o que foi alterado no sistema, com autor, data e hora. Os registros não podem ser editados nem apagados."
      />
      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> : (
        <section className="secao">
          <ListaHistorico
            eventos={dados.data!.eventos}
            pessoas={dados.data!.pessoas}
            mostrarCliente={(id) => (id ? nomes.get(id) ?? null : null)}
          />
        </section>
      )}
    </>
  );
}
