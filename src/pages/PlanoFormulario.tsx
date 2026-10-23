import { useEffect, useState, type FormEvent } from "react";
import { Botao, Campo, CampoSelecao, CampoTexto, Modal } from "../components/ui";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import { atualizarPlano, criarPlano } from "../lib/planos";
import { useAuth } from "../lib/auth";
import type { Plano } from "../types";

export function PlanoFormulario({
  aberto, plano, clienteInicial, onFechar, onSalvo,
}: {
  aberto: boolean;
  plano?: Plano | null;
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
  const [responsavel, setResponsavel] = useState("");
  const [instrucoes, setInstrucoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setClientId(plano?.client_id ?? clienteInicial ?? "");
    setTitulo(plano?.titulo ?? "Plano de Comunicação Digital");
    setResponsavel(plano?.responsavel_id ?? perfil?.id ?? "");
    setInstrucoes(plano?.instrucoes_cliente ?? "");
    setErro(null);
  }, [aberto, plano, clienteInicial, perfil?.id]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!clientId) return setErro("Escolha o cliente.");
    if (!titulo.trim()) return setErro("Dê um título ao plano.");
    setSalvando(true);
    try {
      const campos = { titulo: titulo.trim(), responsavel_id: responsavel || null, instrucoes_cliente: instrucoes.trim() || null };
      if (plano) {
        await atualizarPlano(plano.id, campos);
        onSalvo(plano.id);
      } else {
        onSalvo((await criarPlano({ client_id: clientId, ...campos })).id);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={plano ? "Editar plano" : "Novo plano de comunicação"} onFechar={onFechar} largura={640}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-plano" carregando={salvando}>
          {plano ? "Salvar alterações" : "Criar e subir o PDF"}
        </Botao>
      </>}>
      <form id="form-plano" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <div className="grade-2">
          <CampoSelecao rotulo="Cliente" obrigatorio value={clientId} disabled={!!plano} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Escolha o cliente</option>
            {base.data?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_comercial}</option>)}
          </CampoSelecao>
          <CampoSelecao rotulo="Responsável interno" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Sem responsável</option>
            {base.data?.equipe.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
          </CampoSelecao>
        </div>
        <Campo rotulo="Título" obrigatorio value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
        <CampoTexto rotulo="Recado para o cliente" rows={3} value={instrucoes} maxLength={2000} onChange={(e) => setInstrucoes(e.target.value)}
          ajuda="Aparece no topo da página de aprovação. Ex.: prazo para resposta, como decidir cada seção." />
      </form>
    </Modal>
  );
}
