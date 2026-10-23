import { useEffect, useState, type FormEvent } from "react";
import { Botao, Campo, CampoSelecao, CampoTexto, Modal } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import { criarCampanha, listarCampanhas } from "../lib/criativos";
import { atualizarOrcamento, criarOrcamento } from "../lib/orcamentos";
import { formatarMes, proximoMes } from "../lib/dinheiro";
import { useAuth } from "../lib/auth";
import type { Orcamento, OrcamentoCampos } from "../types";

const NOVA = "__nova__";

export function OrcamentoFormulario({
  aberto, orcamento, clienteInicial, onFechar, onSalvo,
}: {
  aberto: boolean;
  orcamento?: Orcamento | null;
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
  const [mes, setMes] = useState("");
  const [titulo, setTitulo] = useState("");
  const [campanha, setCampanha] = useState("");
  const [novaCampanha, setNovaCampanha] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [instrucoes, setInstrucoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const o = orcamento;
    setClientId(o?.client_id ?? clienteInicial ?? "");
    setMes(o ? o.mes_referencia.slice(0, 7) : proximoMes());
    setTitulo(o?.titulo ?? "");
    setCampanha(o?.campaign_id ?? "");
    setNovaCampanha("");
    setResponsavel(o?.responsavel_id ?? perfil?.id ?? "");
    setInstrucoes(o?.instrucoes_cliente ?? "");
    setErro(null);
  }, [aberto, orcamento, clienteInicial, perfil?.id]);

  const camps = useAsync(() => (clientId ? listarCampanhas(clientId) : Promise.resolve([])), [clientId]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!clientId) return setErro("Escolha o cliente.");
    if (!/^\d{4}-\d{2}$/.test(mes)) return setErro("Escolha o mês de referência.");
    if (campanha === NOVA && !novaCampanha.trim()) return setErro("Digite o nome da campanha nova.");
    setSalvando(true);
    try {
      let campaignId: string | null = campanha && campanha !== NOVA ? campanha : null;
      if (campanha === NOVA) campaignId = (await criarCampanha(clientId, novaCampanha, null)).id;
      const campos: OrcamentoCampos = {
        client_id: clientId, campaign_id: campaignId, mes_referencia: `${mes}-01`, titulo: titulo.trim() || null,
        responsavel_id: responsavel || null, instrucoes_cliente: instrucoes.trim() || null,
      };
      if (orcamento) {
        const { client_id: _ignorado, ...resto } = campos;
        void _ignorado;
        await atualizarOrcamento(orcamento.id, resto);
        onSalvo(orcamento.id);
      } else {
        onSalvo((await criarOrcamento(campos)).id);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={orcamento ? "Editar orçamento" : "Novo orçamento de mídia"} onFechar={onFechar} largura={680}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-orcamento" carregando={salvando}>
          {orcamento ? "Salvar alterações" : "Criar e adicionar valores"}
        </Botao>
      </>}>
      <form id="form-orcamento" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <div className="grade-2">
          <CampoSelecao rotulo="Cliente" obrigatorio value={clientId} disabled={!!orcamento}
            onChange={(e) => { setClientId(e.target.value); setCampanha(""); }}>
            <option value="">Escolha o cliente</option>
            {base.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
          </CampoSelecao>
          <Campo rotulo="Mês de referência" obrigatorio type="month" placeholder="aaaa-mm" value={mes} onChange={(e) => setMes(e.target.value)}
            ajuda={mes ? formatarMes(`${mes}-01`) : undefined} />
          <CampoSelecao rotulo="Campanha" value={campanha} disabled={!clientId} onChange={(e) => setCampanha(e.target.value)}>
            <option value="">Sem campanha</option>
            {camps.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            <option value={NOVA}>+ Nova campanha</option>
          </CampoSelecao>
          {campanha === NOVA ? (
            <Campo rotulo="Nome da campanha nova" value={novaCampanha} onChange={(e) => setNovaCampanha(e.target.value)} />
          ) : (
            <Campo rotulo="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)}
              placeholder={mes ? `Orçamento de ${formatarMes(`${mes}-01`)}` : "Opcional"} ajuda="Opcional." />
          )}
          {campanha === NOVA && (
            <Campo rotulo="Título" className="span-2" value={titulo} onChange={(e) => setTitulo(e.target.value)}
              placeholder={mes ? `Orçamento de ${formatarMes(`${mes}-01`)}` : "Opcional"} ajuda="Opcional." />
          )}
        </div>
        <CampoTexto rotulo="Recado para o cliente" rows={3} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)}
          ajuda="Aparece no topo da página de aprovação." />
        <CampoSelecao rotulo="Responsável interno" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <option value="">Sem responsável</option>
          {base.data?.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
        </CampoSelecao>
      </form>
    </Modal>
  );
}
