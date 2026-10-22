import { useMemo } from "react";
import { descrever } from "../lib/historico";
import { formatarDataHora } from "../lib/format";
import type { EventoAuditoria, Profile } from "../types";
import { Vazio } from "./ui";

export function ListaHistorico({
  eventos, pessoas, mostrarCliente,
}: {
  eventos: EventoAuditoria[];
  pessoas: Profile[];
  mostrarCliente?: (clientId: string | null) => string | null;
}) {
  const mapa = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  if (!eventos.length) return <Vazio titulo="Nada registrado ainda">Cada alteração feita aqui fica registrada com autor, data e hora.</Vazio>;
  return (
    <ol className="historico">
      {eventos.map((e) => {
        const l = descrever(e, mapa);
        const autor = e.actor_id ? mapa.get(e.actor_id) : undefined;
        const cliente = mostrarCliente?.(e.client_id);
        return (
          <li key={e.id}>
            <time dateTime={e.occurred_at}>{formatarDataHora(e.occurred_at)}</time>
            <div>
              <p className="historico-titulo">{l.titulo}</p>
              {l.detalhes.length > 0 && (
                <ul className="historico-det">
                  {l.detalhes.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
              <p className="historico-autor">
                {autor ? `Por ${autor.nome || autor.email}` : e.actor_email ? `Por ${e.actor_email}` : "Pelo sistema"}
                {cliente ? `, em ${cliente}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
