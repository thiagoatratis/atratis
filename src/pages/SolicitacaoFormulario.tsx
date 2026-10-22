import { useEffect, useState, type FormEvent } from "react";
import { Botao, Campo, CampoSelecao, CampoTexto, Modal } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import { atualizarSolicitacao, criarCampanha, criarSolicitacao, listarCampanhas } from "../lib/criativos";
import { useAuth } from "../lib/auth";
import type { Solicitacao, SolicitacaoCampos } from "../types";

const NOVA = "__nova__";

export function SolicitacaoFormulario({
  aberto, solicitacao, clienteInicial, onFechar, onSalvo,
}: {
  aberto: boolean;
  solicitacao?: Solicitacao | null;
  clienteInicial?: string;
  onFechar: () => void;
  onSalvo: (id: string) => void;
}) {
  const { perfil } = useAuth();
  const base = useAsync(async () => {
    const [clientes, usuarios] = await Promise.all([listarClientes(), listarUsuarios()]);
    return { clientes: clientes.filter((c) => c.ativo), equipe: usuarios.filter((u) => u.role !== "cliente" && u.ativo) };
  }, []);

  const [clientId, setClientId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [campanha, setCampanha] = useState("");
  const [novaCampanha, setNovaCampanha] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [prazo, setPrazo] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [instrucoes, setInstrucoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const s = solicitacao;
    setClientId(s?.client_id ?? clienteInicial ?? "");
    setTitulo(s?.titulo ?? "");
    setCampanha(s?.campaign_id ?? "");
    setNovaCampanha("");
    setObjetivo(s?.objetivo ?? "");
    setInicio(s?.veiculacao_inicio ?? "");
    setFim(s?.veiculacao_fim ?? "");
    setPrazo(s?.prazo_aprovacao ?? "");
    setResponsavel(s?.responsavel_id ?? perfil?.id ?? "");
    setInstrucoes(s?.instrucoes_cliente ?? "");
    setErro(null);
  }, [aberto, solicitacao, clienteInicial, perfil?.id]);

  const camps = useAsync(() => (clientId ? listarCampanhas(clientId) : Promise.resolve([])), [clientId]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!clientId) return setErro("Escolha o cliente.");
    if (!titulo.trim()) return setErro("Dê um título para a solicitação.");
    if (campanha === NOVA && !novaCampanha.trim()) return setErro("Digite o nome da campanha nova.");
    if (inicio && fim && fim < inicio) return setErro("O fim da veiculação é antes do início.");
    setSalvando(true);
    try {
      let campaignId: string | null = campanha && campanha !== NOVA ? campanha : null;
      if (campanha === NOVA) campaignId = (await criarCampanha(clientId, novaCampanha, objetivo.trim() || null)).id;
      const campos: SolicitacaoCampos = {
        client_id: clientId, campaign_id: campaignId, titulo: titulo.trim(), objetivo: objetivo.trim() || null,
        veiculacao_inicio: inicio || null, veiculacao_fim: fim || null, prazo_aprovacao: prazo || null,
        responsavel_id: responsavel || null, instrucoes_cliente: instrucoes.trim() || null,
      };
      if (solicitacao) {
        const { client_id: _ignorado, ...resto } = campos;
        void _ignorado;
        await atualizarSolicitacao(solicitacao.id, resto);
        onSalvo(solicitacao.id);
      } else {
        onSalvo((await criarSolicitacao(campos)).id);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={solicitacao ? "Editar solicitação" : "Nova solicitação de criativos"} onFechar={onFechar} largura={720}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-solicitacao" carregando={salvando}>
          {solicitacao ? "Salvar alterações" : "Criar e adicionar peças"}
        </Botao>
      </>}>
      <form id="form-solicitacao" onSubmit={salvar} noValidate>
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <fieldset className="grupo">
          <legend>O que vai para aprovação</legend>
          <div className="grade-2">
            <CampoSelecao rotulo="Cliente" obrigatorio value={clientId} disabled={!!solicitacao}
              onChange={(e) => { setClientId(e.target.value); setCampanha(""); }}>
              <option value="">Escolha o cliente</option>
              {base.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
            </CampoSelecao>
            <Campo rotulo="Título" obrigatorio value={titulo} onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Criativos de novembro" />
            <CampoSelecao rotulo="Campanha" value={campanha} disabled={!clientId}
              onChange={(e) => setCampanha(e.target.value)}>
              <option value="">Sem campanha</option>
              {camps.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              <option value={NOVA}>+ Nova campanha</option>
            </CampoSelecao>
            {campanha === NOVA ? (
              <Campo rotulo="Nome da campanha nova" value={novaCampanha} onChange={(e) => setNovaCampanha(e.target.value)} />
            ) : (
              <Campo rotulo="Objetivo da campanha" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}
                placeholder="Ex.: geração de leads" />
            )}
            {campanha === NOVA && (
              <Campo rotulo="Objetivo da campanha" className="span-2" value={objetivo} onChange={(e) => setObjetivo(e.target.value)}
                placeholder="Ex.: geração de leads" />
            )}
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>Prazos</legend>
          <div className="grade-3">
            <Campo rotulo="Veiculação de" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            <Campo rotulo="Veiculação até" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            <Campo rotulo="Aprovar até" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>Para o cliente</legend>
          <CampoTexto rotulo="Instruções para o cliente" rows={3} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)}
            ajuda="Aparece no topo da página de aprovação." />
        </fieldset>
        <CampoSelecao rotulo="Responsável interno" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Sem responsável</option>
          {base.data?.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
        </CampoSelecao>
      </form>
    </Modal>
  );
}
