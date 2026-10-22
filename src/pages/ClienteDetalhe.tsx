import { useEffect, useState, type FormEvent } from "react";
import { LuArrowLeft, LuMail, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import {
  alterarVinculo, buscarUsuarioPorEmail, convidarUsuario, enviarLinkAcesso, historicoCliente,
  liberarAcessoEquipe, listarAcessosEquipe, listarUsuarios, listarVinculos, obterCliente,
  obterObservacoes, removerAcessoEquipe, removerVinculo, salvarObservacoes, vincularAprovador,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { Link, useRouter } from "../lib/router";
import { emailValido, enderecoCompleto, formatarCNPJ, formatarDataHora } from "../lib/format";
import {
  Alternador, AvisoErro, Botao, CabecalhoPagina, Campo, CampoSelecao, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso,
} from "../components/ui";
import { ListaHistorico } from "../components/ListaHistorico";
import { ClienteFormulario } from "./ClienteFormulario";
import type { Cliente } from "../types";

type Aba = "cadastro" | "aprovadores" | "equipe" | "observacoes" | "historico";

export function ClienteDetalhe({ id }: { id: string }) {
  const { perfil } = useAuth();
  const { search, navigate } = useRouter();
  const admin = perfil?.role === "admin";
  const aba = (search.get("aba") as Aba) || "cadastro";
  const [editando, setEditando] = useState(false);
  const avisar = useAviso();

  const cli = useAsync(() => obterCliente(id), [id]);

  const abas: { k: Aba; rotulo: string }[] = [
    { k: "cadastro", rotulo: "Cadastro" },
    { k: "aprovadores", rotulo: "Aprovadores" },
    ...(admin ? [{ k: "equipe" as Aba, rotulo: "Equipe" }] : []),
    { k: "observacoes", rotulo: "Observações internas" },
    { k: "historico", rotulo: "Histórico" },
  ];

  if (cli.loading && !cli.data) return <Carregando />;
  if (cli.error) return <AvisoErro erro={cli.error} tentarDeNovo={cli.reload} />;
  if (!cli.data) {
    return (
      <Vazio titulo="Cliente não encontrado" acao={<Link to="/clientes" className="btn btn-secundario">Voltar para clientes</Link>}>
        Ele pode ter sido removido ou você não tem acesso a ele.
      </Vazio>
    );
  }
  const c = cli.data;

  return (
    <>
      <CabecalhoPagina
        voltar={<Link to="/clientes" className="voltar"><LuArrowLeft /> Clientes</Link>}
        titulo={<>{c.nome_comercial} {!c.ativo && <Selo>Inativo</Selo>}</>}
        descricao={c.razao_social || undefined}
        acoes={admin && (
          <Botao onClick={() => setEditando(true)}><LuPencil /> Editar cadastro</Botao>
        )}
      />

      <nav className="abas" aria-label="Seções do cliente">
        {abas.map((a) => (
          <Link
            key={a.k}
            to={`/clientes/${id}${a.k === "cadastro" ? "" : `?aba=${a.k}`}`}
            className={aba === a.k ? "on" : ""}
            aria-current={aba === a.k ? "page" : undefined}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      {aba === "cadastro" && <AbaCadastro c={c} />}
      {aba === "aprovadores" && <AbaAprovadores cliente={c} admin={admin} />}
      {aba === "equipe" && admin && <AbaEquipe cliente={c} />}
      {aba === "observacoes" && <AbaObservacoes clientId={c.id} />}
      {aba === "historico" && <AbaHistorico clientId={c.id} />}

      {admin && (
        <ClienteFormulario
          aberto={editando}
          cliente={c}
          onFechar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            avisar("Cadastro atualizado.");
            void cli.reload();
            navigate(`/clientes/${id}`, { replace: true });
          }}
        />
      )}
    </>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="dado">
      <dt>{rotulo}</dt>
      <dd>{valor || <span className="falta">Não informado</span>}</dd>
    </div>
  );
}

function AbaCadastro({ c }: { c: Cliente }) {
  const faltaPI = [!c.razao_social && "razão social", !c.cnpj && "CNPJ", !c.endereco && "endereço", !c.telefone && "telefone"]
    .filter(Boolean) as string[];
  return (
    <section className="secao">
      {faltaPI.length > 0 && (
        <div className="aviso aviso-atencao">
          <p>Para emitir Pedido de Inserção deste cliente ainda falta: {faltaPI.join(", ")}.</p>
        </div>
      )}
      <dl className="dados">
        <Dado rotulo="Nome comercial" valor={c.nome_comercial} />
        <Dado rotulo="Razão social" valor={c.razao_social} />
        <Dado rotulo="CNPJ" valor={c.cnpj ? formatarCNPJ(c.cnpj) : null} />
        <Dado rotulo="Telefone" valor={c.telefone} />
        <Dado rotulo="E-mail de contato" valor={c.email_contato} />
        <Dado rotulo="Endereço" valor={enderecoCompleto(c)} />
        <Dado rotulo="Cadastrado em" valor={formatarDataHora(c.created_at)} />
        <Dado rotulo="Última alteração" valor={formatarDataHora(c.updated_at)} />
      </dl>
    </section>
  );
}

function AbaAprovadores({ cliente, admin }: { cliente: Cliente; admin: boolean }) {
  const avisar = useAviso();
  const vinc = useAsync(() => listarVinculos(cliente.id), [cliente.id]);
  const [adicionando, setAdicionando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<{ id: string; email: string } | null>(null);

  async function acao(chave: string, fn: () => Promise<unknown>, ok: string) {
    setOcupado(chave);
    try {
      await fn();
      avisar(ok);
      await vinc.reload();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado(null);
    }
  }

  const lista = (vinc.data ?? []).sort((a, b) =>
    (a.profile?.nome || a.profile?.email || "").localeCompare(b.profile?.nome || b.profile?.email || ""));

  return (
    <section className="secao">
      <div className="secao-topo">
        <p className="secao-desc">
          Pessoas do cliente que entram no portal. O acesso é liberado uma a uma, por e-mail.
        </p>
        {admin && <Botao variante="primario" onClick={() => setAdicionando(true)}><LuPlus /> Adicionar pessoa</Botao>}
      </div>
      {vinc.loading && !vinc.data ? <Carregando /> : vinc.error ? <AvisoErro erro={vinc.error} tentarDeNovo={vinc.reload} /> :
        !lista.length ? (
          <Vazio titulo="Ninguém do cliente tem acesso ainda">
            {admin ? "Adicione quem vai aprovar criativos e orçamentos por esta empresa." : "Peça a um administrador para cadastrar os aprovadores."}
          </Vazio>
        ) : (
          <div className="tabela-moldura">
            <table className="tabela">
              <thead>
                <tr><th>Pessoa</th><th>Permissão</th><th>Situação</th>{admin && <th><span className="sr">Ações</span></th>}</tr>
              </thead>
              <tbody>
                {lista.map((v) => {
                  const k = v.user_id;
                  return (
                    <tr key={k}>
                      <td>
                        <span className="celula-titulo">{v.profile?.nome || v.profile?.email}</span>
                        {v.profile?.nome && <span className="celula-sub">{v.profile.email}</span>}
                      </td>
                      <td>
                        {admin ? (
                          <Alternador
                            marcado={v.pode_aprovar}
                            rotulo={v.pode_aprovar ? "Pode aprovar" : "Só visualiza"}
                            disabled={ocupado === k}
                            onChange={(val) => void acao(k, () => alterarVinculo(cliente.id, k, { pode_aprovar: val }),
                              val ? "Agora pode aprovar." : "Agora só visualiza.")}
                          />
                        ) : v.pode_aprovar ? "Pode aprovar" : "Só visualiza"}
                      </td>
                      <td>
                        {!v.profile?.ativo ? <Selo>Usuário inativo</Selo> : v.ativo ? <Selo tom="ok">Com acesso</Selo> : <Selo>Acesso suspenso</Selo>}
                      </td>
                      {admin && (
                        <td className="acoes-linha">
                          <Botao variante="fantasma" disabled={ocupado === k || !v.profile?.ativo}
                            title="Enviar link de acesso por e-mail"
                            onClick={() => void acao(k, () => enviarLinkAcesso(k), `Link enviado para ${v.profile?.email}.`)}>
                            <LuMail /> Enviar link
                          </Botao>
                          <Botao variante="fantasma" disabled={ocupado === k}
                            onClick={() => void acao(k, () => alterarVinculo(cliente.id, k, { ativo: !v.ativo }),
                              v.ativo ? "Acesso suspenso." : "Acesso reativado.")}>
                            {v.ativo ? "Suspender" : "Reativar"}
                          </Botao>
                          <Botao variante="fantasma" className="perigo-texto" disabled={ocupado === k}
                            aria-label={`Remover acesso de ${v.profile?.email}`}
                            onClick={() => setRemovendo({ id: k, email: v.profile?.email ?? "" })}>
                            <LuTrash2 />
                          </Botao>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <Modal
        aberto={!!removendo}
        titulo="Remover acesso"
        onFechar={() => setRemovendo(null)}
        largura={460}
        rodape={
          <>
            <Botao variante="fantasma" onClick={() => setRemovendo(null)}>Cancelar</Botao>
            <Botao variante="perigo" carregando={!!removendo && ocupado === removendo.id}
              onClick={async () => {
                if (!removendo) return;
                await acao(removendo.id, () => removerVinculo(cliente.id, removendo.id), "Acesso removido.");
                setRemovendo(null);
              }}>
              Remover acesso
            </Botao>
          </>
        }
      >
        <p>
          {removendo?.email} deixa de ver {cliente.nome_comercial} no portal. O histórico de aprovações dessa
          pessoa continua guardado.
        </p>
      </Modal>
      {admin && (
        <NovoAprovador
          aberto={adicionando}
          cliente={cliente}
          onFechar={() => setAdicionando(false)}
          onPronto={(msg) => {
            setAdicionando(false);
            avisar(msg);
            void vinc.reload();
          }}
        />
      )}
    </section>
  );
}

function NovoAprovador({
  aberto, cliente, onFechar, onPronto,
}: { aberto: boolean; cliente: Cliente; onFechar: () => void; onPronto: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [podeAprovar, setPodeAprovar] = useState(true);
  const [enviarLink, setEnviarLink] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setEmail(""); setNome(""); setPodeAprovar(true); setEnviarLink(true); setErro(null);
    }
  }, [aberto]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const alvo = email.trim().toLowerCase();
    if (!emailValido(alvo)) {
      setErro("Digite um e-mail válido.");
      return;
    }
    setSalvando(true);
    try {
      const existente = await buscarUsuarioPorEmail(alvo);
      if (existente) {
        if (existente.role !== "cliente") {
          setErro("Este e-mail pertence a alguém da equipe interna. Use outro e-mail para o acesso do cliente.");
          return;
        }
        await vincularAprovador(cliente.id, existente.id, podeAprovar);
        let msg = `${alvo} agora acessa ${cliente.nome_comercial}.`;
        if (enviarLink) {
          try {
            await enviarLinkAcesso(existente.id);
            msg += " Link enviado.";
          } catch (err) {
            msg += ` O link não saiu: ${err instanceof Error ? err.message : err}`;
          }
        }
        onPronto(msg);
      } else {
        const r = await convidarUsuario({
          email: alvo, nome, perfil: "cliente",
          empresas: [{ client_id: cliente.id, pode_aprovar: podeAprovar }],
          enviar_link: enviarLink,
        });
        onPronto(r.avisos.length ? r.avisos.join(" ") : `${alvo} cadastrado${r.link_enviado ? " e link enviado" : ""}.`);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setErro(/duplicate|23505|já/i.test(m) ? "Esta pessoa já tem acesso a este cliente." : m);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={`Dar acesso a ${cliente.nome_comercial}`}
      onFechar={onFechar}
      rodape={
        <>
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" type="submit" form="form-aprovador" carregando={salvando}>Liberar acesso</Botao>
        </>
      }
    >
      <form id="form-aprovador" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <Campo rotulo="E-mail" type="email" obrigatorio value={email} onChange={(e) => setEmail(e.target.value)}
          ajuda="Se a pessoa já tiver cadastro, ela só ganha acesso a mais esta empresa." autoFocus />
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Alternador marcado={podeAprovar} onChange={setPodeAprovar} rotulo="Pode aprovar"
          descricao="Desligado, a pessoa vê criativos e orçamentos, mas não aprova nem pede alteração." />
        <Alternador marcado={enviarLink} onChange={setEnviarLink} rotulo="Enviar link de acesso agora"
          descricao="A pessoa recebe um e-mail para entrar, sem precisar de senha." />
      </form>
    </Modal>
  );
}

function AbaEquipe({ cliente }: { cliente: Cliente }) {
  const avisar = useAviso();
  const dados = useAsync(async () => {
    const [acessos, usuarios] = await Promise.all([listarAcessosEquipe(cliente.id), listarUsuarios()]);
    return { acessos, equipe: usuarios.filter((u) => u.role === "equipe" && u.ativo) };
  }, [cliente.id]);
  const [escolhido, setEscolhido] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function acao(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      avisar(ok);
      setEscolhido("");
      await dados.reload();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  if (dados.loading && !dados.data) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  const { acessos, equipe } = dados.data!;
  const disponiveis = equipe.filter((u) => !acessos.some((a) => a.user_id === u.id));

  return (
    <section className="secao">
      <p className="secao-desc">
        Pessoas da equipe interna que acompanham este cliente. Administradores veem todos os clientes.
      </p>
      <form className="linha-form" onSubmit={(e) => {
        e.preventDefault();
        if (escolhido) void acao(() => liberarAcessoEquipe(cliente.id, escolhido), "Acesso liberado.");
      }}>
        <CampoSelecao rotulo="Liberar para" value={escolhido} onChange={(e) => setEscolhido(e.target.value)}
          disabled={!disponiveis.length}>
          <option value="">{disponiveis.length ? "Escolha uma pessoa da equipe" : "Toda a equipe já tem acesso"}</option>
          {disponiveis.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
        </CampoSelecao>
        <Botao type="submit" variante="primario" disabled={!escolhido} carregando={ocupado}>Liberar</Botao>
      </form>
      {!acessos.length ? (
        <Vazio titulo="Só administradores veem este cliente">Libere o acesso para quem da equipe atende a conta.</Vazio>
      ) : (
        <ul className="lista-simples">
          {acessos.map((a) => (
            <li key={a.user_id}>
              <span>
                <strong>{a.profile?.nome || a.profile?.email}</strong>
                {a.profile?.nome && <small>{a.profile.email}</small>}
              </span>
              <Botao variante="fantasma" disabled={ocupado}
                onClick={() => void acao(() => removerAcessoEquipe(cliente.id, a.user_id), "Acesso removido.")}>
                Remover
              </Botao>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AbaObservacoes({ clientId }: { clientId: string }) {
  const avisar = useAviso();
  const obs = useAsync(() => obterObservacoes(clientId), [clientId]);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (obs.data !== undefined) setTexto(obs.data);
  }, [obs.data]);

  if (obs.loading && obs.data === undefined) return <Carregando />;
  if (obs.error) return <AvisoErro erro={obs.error} tentarDeNovo={obs.reload} />;
  const mudou = texto !== (obs.data ?? "");

  return (
    <section className="secao">
      <form className="pilha" onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        try {
          await salvarObservacoes(clientId, texto);
          avisar("Observações salvas.");
          await obs.reload();
        } catch (err) {
          avisar(err instanceof Error ? err.message : String(err), "erro");
        } finally {
          setSalvando(false);
        }
      }}>
        <CampoTexto rotulo="Observações internas" rows={8} value={texto} onChange={(e) => setTexto(e.target.value)}
          ajuda="Só a equipe da Atratis vê este campo. O cliente nunca tem acesso a ele." />
        <div><Botao type="submit" variante="primario" disabled={!mudou} carregando={salvando}>Salvar observações</Botao></div>
      </form>
    </section>
  );
}

function AbaHistorico({ clientId }: { clientId: string }) {
  const dados = useAsync(async () => {
    const [eventos, pessoas] = await Promise.all([historicoCliente(clientId), listarUsuarios()]);
    return { eventos, pessoas };
  }, [clientId]);
  if (dados.loading && !dados.data) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  return (
    <section className="secao">
      <ListaHistorico eventos={dados.data!.eventos} pessoas={dados.data!.pessoas} />
    </section>
  );
}
