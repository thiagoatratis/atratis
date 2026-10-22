import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LuMail, LuPencil, LuPlus, LuSearch } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import {
  alterarVinculo, atualizarUsuario, convidarUsuario, enviarLinkAcesso, liberarAcessoEquipe, listarAcessosEquipe,
  listarClientes, listarUsuarios, listarVinculos, removerAcessoEquipe, removerVinculo, vincularAprovador,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { emailValido } from "../lib/format";
import {
  Alternador, AvisoErro, Botao, CabecalhoPagina, Campo, CampoSelecao, Carregando, Modal, Selo, Vazio, useAviso,
} from "../components/ui";
import { PERFIL_ROTULO, type AcessoEquipe, type Cliente, type Perfil, type Profile, type Vinculo } from "../types";

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Dados {
  usuarios: Profile[];
  clientes: Cliente[];
  vinculos: Vinculo[];
  acessos: AcessoEquipe[];
}

export function Usuarios() {
  const { perfil: eu } = useAuth();
  const avisar = useAviso();
  const [busca, setBusca] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState<"" | Perfil>("");
  const [convidando, setConvidando] = useState(false);
  const [editando, setEditando] = useState<Profile | null>(null);

  const dados = useAsync<Dados>(async () => {
    const [usuarios, clientes, vinculos, acessos] = await Promise.all([
      listarUsuarios(), listarClientes(), listarVinculos(), listarAcessosEquipe(),
    ]);
    return { usuarios, clientes, vinculos, acessos };
  }, []);

  const nomeCliente = useMemo(
    () => new Map((dados.data?.clientes ?? []).map((c) => [c.id, c.nome_comercial])),
    [dados.data],
  );

  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados.data?.usuarios ?? [])
      .filter((u) => !filtroPerfil || u.role === filtroPerfil)
      .filter((u) => !q || normalizar(`${u.nome ?? ""} ${u.email}`).includes(q))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || (a.nome || a.email).localeCompare(b.nome || b.email));
  }, [dados.data, busca, filtroPerfil]);

  function empresasDe(u: Profile): string {
    const d = dados.data;
    if (!d) return "";
    if (u.role === "admin") return "Todos os clientes";
    const ids = u.role === "cliente"
      ? d.vinculos.filter((v) => v.user_id === u.id).map((v) => v.client_id)
      : d.acessos.filter((a) => a.user_id === u.id).map((a) => a.client_id);
    return ids.map((id) => nomeCliente.get(id) ?? "?").sort().join(", ");
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Quem entra no sistema e o que cada pessoa enxerga."
        acoes={<Botao variante="primario" onClick={() => setConvidando(true)}><LuPlus /> Convidar usuário</Botao>}
      />
      <div className="barra-filtros">
        <label className="busca">
          <LuSearch aria-hidden />
          <span className="sr">Buscar usuário</span>
          <input type="search" placeholder="Buscar por nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <div className="segmentado" role="group" aria-label="Perfil">
          {(["", "admin", "equipe", "cliente"] as const).map((p) => (
            <button key={p} className={filtroPerfil === p ? "on" : ""} aria-pressed={filtroPerfil === p} onClick={() => setFiltroPerfil(p)}>
              {p ? PERFIL_ROTULO[p] : "Todos"}
            </button>
          ))}
        </div>
      </div>

      {dados.loading && !dados.data ? <Carregando /> : dados.error ? <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} /> :
        !lista.length ? <Vazio titulo="Nenhum usuário encontrado">Mude a busca ou o filtro de perfil.</Vazio> : (
          <div className="tabela-moldura">
            <table className="tabela">
              <thead>
                <tr><th>Pessoa</th><th className="col-opcional">Perfil</th><th className="col-opcional">Acessa</th><th>Situação</th><th><span className="sr">Ações</span></th></tr>
              </thead>
              <tbody>
                {lista.map((u) => {
                  const acessa = empresasDe(u);
                  return (
                    <tr key={u.id} className={u.ativo ? "" : "linha-apagada"}>
                      <td>
                        <span className="celula-titulo">{u.nome || u.email}{u.id === eu?.id && " (você)"}</span>
                        {u.nome && <span className="celula-sub">{u.email}</span>}
                      </td>
                      <td className="col-opcional">{PERFIL_ROTULO[u.role]}</td>
                      <td className="celula-quebra col-opcional">{acessa || <span className="falta">Nenhum cliente</span>}</td>
                      <td>{u.ativo ? <Selo tom="ok">Ativo</Selo> : <Selo>Inativo</Selo>}</td>
                      <td className="acoes-linha">
                        <Botao variante="fantasma" onClick={() => setEditando(u)}><LuPencil /> Editar</Botao>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {dados.data && (
        <>
          <ConvidarUsuario
            aberto={convidando}
            clientes={dados.data.clientes}
            onFechar={() => setConvidando(false)}
            onPronto={(msg, tom) => {
              setConvidando(false);
              avisar(msg, tom);
              void dados.reload();
            }}
          />
          <EditarUsuario
            usuario={editando}
            dados={dados.data}
            souEu={editando?.id === eu?.id}
            onFechar={() => setEditando(null)}
            onPronto={(msg) => {
              setEditando(null);
              avisar(msg);
              void dados.reload();
            }}
          />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------
// Seleção de clientes (usada no convite e na edição)
// ------------------------------------------------------------------

function EscolhaClientes({
  clientes, perfil, selecionados, aprovam, onAlternar, onAprovar,
}: {
  clientes: Cliente[];
  perfil: Perfil;
  selecionados: Set<string>;
  aprovam: Set<string>;
  onAlternar: (id: string) => void;
  onAprovar: (id: string, v: boolean) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const q = normalizar(filtro);
  const visiveis = clientes.filter((c) => c.ativo || selecionados.has(c.id)).filter((c) => !q || normalizar(c.nome_comercial).includes(q));
  return (
    <fieldset className="grupo">
      <legend>{perfil === "cliente" ? "Empresas que esta pessoa acessa" : "Clientes que esta pessoa acompanha"}</legend>
      {clientes.length > 8 && (
        <input className="filtro-mini" type="search" placeholder="Filtrar clientes" value={filtro}
          onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar clientes" />
      )}
      <ul className="escolhas">
        {visiveis.map((c) => {
          const marcado = selecionados.has(c.id);
          return (
            <li key={c.id}>
              <label className="check">
                <input type="checkbox" checked={marcado} onChange={() => onAlternar(c.id)} />
                <span>{c.nome_comercial}{!c.ativo && " (inativo)"}</span>
              </label>
              {perfil === "cliente" && marcado && (
                <label className="check check-sub">
                  <input type="checkbox" checked={aprovam.has(c.id)} onChange={(e) => onAprovar(c.id, e.target.checked)} />
                  <span>pode aprovar</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function useSelecao(inicial: string[] = [], inicialAprova: string[] = []) {
  const [sel, setSel] = useState(new Set(inicial));
  const [apr, setApr] = useState(new Set(inicialAprova));
  return {
    sel, apr,
    reset(i: string[], a: string[]) { setSel(new Set(i)); setApr(new Set(a)); },
    alternar(id: string) {
      setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      setApr((s) => { const n = new Set(s); if (!sel.has(id)) n.add(id); return n; });
    },
    aprovar(id: string, v: boolean) {
      setApr((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
    },
  };
}

// ------------------------------------------------------------------
// Convite
// ------------------------------------------------------------------

function ConvidarUsuario({
  aberto, clientes, onFechar, onPronto,
}: { aberto: boolean; clientes: Cliente[]; onFechar: () => void; onPronto: (msg: string, tom?: "ok" | "erro") => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("cliente");
  const [enviarLink, setEnviarLink] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const s = useSelecao();

  useEffect(() => {
    if (aberto) {
      setEmail(""); setNome(""); setPerfil("cliente"); setEnviarLink(true); setErro(null); s.reset([], []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!emailValido(email)) return setErro("Digite um e-mail válido.");
    if (perfil === "cliente" && !s.sel.size) return setErro("Escolha pelo menos uma empresa para este cliente acessar.");
    setSalvando(true);
    try {
      const r = await convidarUsuario({
        email: email.trim().toLowerCase(), nome: nome.trim(), perfil,
        empresas: perfil === "cliente" ? [...s.sel].map((id) => ({ client_id: id, pode_aprovar: s.apr.has(id) })) : [],
        clientes_equipe: perfil === "equipe" ? [...s.sel] : [],
        enviar_link: enviarLink,
      });
      if (r.avisos.length) onPronto(r.avisos.join(" "), "erro");
      else onPronto(`${email.trim().toLowerCase()} cadastrado${r.link_enviado ? " e link de acesso enviado" : ""}.`);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Convidar usuário" onFechar={onFechar} largura={620}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-convite" carregando={salvando}>Convidar</Botao>
      </>}>
      <form id="form-convite" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <div className="grade-2">
          <Campo rotulo="E-mail" type="email" obrigatorio value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <CampoSelecao rotulo="Perfil" value={perfil} onChange={(e) => { setPerfil(e.target.value as Perfil); s.reset([], []); }}
          ajuda={perfil === "admin" ? "Acesso completo, inclusive usuários e dados da agência."
            : perfil === "equipe" ? "Vê só os clientes liberados abaixo. Cria solicitações e orçamentos."
            : "Vê só as empresas marcadas abaixo e aprova o que for enviado."}>
          <option value="cliente">{PERFIL_ROTULO.cliente}</option>
          <option value="equipe">{PERFIL_ROTULO.equipe}</option>
          <option value="admin">{PERFIL_ROTULO.admin}</option>
        </CampoSelecao>
        {perfil !== "admin" && (
          <EscolhaClientes clientes={clientes} perfil={perfil} selecionados={s.sel} aprovam={s.apr}
            onAlternar={s.alternar} onAprovar={s.aprovar} />
        )}
        <Alternador marcado={enviarLink} onChange={setEnviarLink} rotulo="Enviar link de acesso agora"
          descricao="A pessoa recebe um e-mail para entrar. Dá para enviar depois também." />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Edição
// ------------------------------------------------------------------

function EditarUsuario({
  usuario, dados, souEu, onFechar, onPronto,
}: { usuario: Profile | null; dados: Dados; souEu: boolean; onFechar: () => void; onPronto: (msg: string) => void }) {
  const avisar = useAviso();
  const [nome, setNome] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("cliente");
  const [ativo, setAtivo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const s = useSelecao();

  const atuais = useMemo(() => {
    if (!usuario) return { ids: [] as string[], aprovam: [] as string[] };
    if (usuario.role === "cliente") {
      const v = dados.vinculos.filter((x) => x.user_id === usuario.id);
      return { ids: v.map((x) => x.client_id), aprovam: v.filter((x) => x.pode_aprovar).map((x) => x.client_id) };
    }
    return { ids: dados.acessos.filter((x) => x.user_id === usuario.id).map((x) => x.client_id), aprovam: [] };
  }, [usuario, dados]);

  useEffect(() => {
    if (usuario) {
      setNome(usuario.nome ?? ""); setPerfil(usuario.role); setAtivo(usuario.ativo); setErro(null);
      s.reset(atuais.ids, atuais.aprovam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, atuais]);

  if (!usuario) return <Modal aberto={false} titulo="" onFechar={onFechar}>{null}</Modal>;
  const mudouPerfil = perfil !== usuario.role;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!usuario) return;
    setErro(null);
    setSalvando(true);
    try {
      const campos: { nome?: string; perfil?: Perfil; ativo?: boolean } = {};
      if (nome.trim() !== (usuario.nome ?? "")) campos.nome = nome.trim();
      if (mudouPerfil) campos.perfil = perfil;
      if (ativo !== usuario.ativo) campos.ativo = ativo;
      if (Object.keys(campos).length) {
        const r = await atualizarUsuario(usuario.id, campos);
        if (r.avisos?.length) avisar(r.avisos.join(" "), "erro");
      }

      // Vínculos: compara o que estava com o que ficou marcado.
      const antes = new Set(mudouPerfil ? [] : atuais.ids);
      const depois = s.sel;
      if (perfil === "cliente") {
        for (const id of depois) {
          if (!antes.has(id)) await vincularAprovador(id, usuario.id, s.apr.has(id));
          else if (atuais.aprovam.includes(id) !== s.apr.has(id)) await alterarVinculo(id, usuario.id, { pode_aprovar: s.apr.has(id) });
        }
        for (const id of antes) if (!depois.has(id)) await removerVinculo(id, usuario.id);
      } else if (perfil === "equipe") {
        for (const id of depois) if (!antes.has(id)) await liberarAcessoEquipe(id, usuario.id);
        for (const id of antes) if (!depois.has(id)) await removerAcessoEquipe(id, usuario.id);
      }
      onPronto("Usuário atualizado.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={!!usuario} titulo={`Editar ${usuario.nome || usuario.email}`} onFechar={onFechar} largura={620}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-usuario" carregando={salvando}>Salvar alterações</Botao>
      </>}>
      <form id="form-usuario" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <div className="grade-2">
          <Campo rotulo="E-mail" value={usuario.email} disabled ajuda="O e-mail é o login e não muda por aqui." />
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <CampoSelecao rotulo="Perfil" value={perfil} disabled={souEu}
          onChange={(e) => { setPerfil(e.target.value as Perfil); s.reset([], []); }}
          ajuda={souEu ? "Você não pode mudar o seu próprio perfil." : mudouPerfil
            ? "Ao mudar o perfil, os acessos anteriores são removidos. Marque os novos abaixo." : undefined}>
          <option value="cliente">{PERFIL_ROTULO.cliente}</option>
          <option value="equipe">{PERFIL_ROTULO.equipe}</option>
          <option value="admin">{PERFIL_ROTULO.admin}</option>
        </CampoSelecao>
        {perfil !== "admin" && (
          <EscolhaClientes clientes={dados.clientes} perfil={perfil} selecionados={s.sel} aprovam={s.apr}
            onAlternar={s.alternar} onAprovar={s.aprovar} />
        )}
        <Alternador marcado={ativo} onChange={setAtivo} disabled={souEu} rotulo="Usuário ativo"
          descricao="Inativo não consegue entrar e perde o acesso a tudo, sem apagar o histórico." />
        {usuario.ativo && (
          <div>
            <Botao variante="secundario" carregando={enviando} onClick={async () => {
              setEnviando(true);
              try {
                await enviarLinkAcesso(usuario.id);
                avisar(`Link de acesso enviado para ${usuario.email}.`);
              } catch (err) {
                avisar(err instanceof Error ? err.message : String(err), "erro");
              } finally {
                setEnviando(false);
              }
            }}>
              <LuMail /> Enviar link de acesso
            </Botao>
          </div>
        )}
      </form>
    </Modal>
  );
}
