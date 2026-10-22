import { useEffect, useState, type FormEvent } from "react";
import { useAsync } from "../lib/useAsync";
import { obterAgencia, salvarAgencia } from "../lib/api";
import { cnpjValido, formatarCEP, formatarCNPJ, formatarDataHora, soDigitos, UFS } from "../lib/format";
import { AvisoErro, Botao, CabecalhoPagina, Campo, CampoSelecao, Carregando, useAviso } from "../components/ui";

interface Form {
  nome: string; razao_social: string; cnpj: string; endereco: string; bairro: string;
  cidade: string; uf: string; cep: string; telefone: string; email: string;
}

export function Configuracoes() {
  const avisar = useAviso();
  const ag = useAsync(obterAgencia, []);
  const [f, setF] = useState<Form | null>(null);
  const [erros, setErros] = useState<Partial<Record<keyof Form, string>>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const a = ag.data;
    if (!a) return;
    setF({
      nome: a.nome, razao_social: a.razao_social ?? "", cnpj: formatarCNPJ(a.cnpj), endereco: a.endereco ?? "",
      bairro: a.bairro ?? "", cidade: a.cidade ?? "", uf: a.uf ?? "", cep: formatarCEP(a.cep),
      telefone: a.telefone ?? "", email: a.email ?? "",
    });
  }, [ag.data]);

  if (ag.loading && !ag.data) return <Carregando />;
  if (ag.error) return <AvisoErro erro={ag.error} tentarDeNovo={ag.reload} />;
  if (!f) return <AvisoErro erro="Os dados da agência ainda não foram cadastrados no banco. Rode as migrations do projeto." />;

  const set = (k: keyof Form, v: string) => setF((x) => (x ? { ...x, [k]: v } : x));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    const m: Partial<Record<keyof Form, string>> = {};
    if (!f.nome.trim()) m.nome = "Informe o nome da agência.";
    if (f.cnpj.trim() && !cnpjValido(f.cnpj)) m.cnpj = "CNPJ inválido.";
    if (f.cep.trim() && soDigitos(f.cep).length !== 8) m.cep = "O CEP tem 8 dígitos.";
    setErros(m);
    if (Object.keys(m).length) return;
    setSalvando(true);
    try {
      const nul = (s: string) => s.trim() || null;
      await salvarAgencia({
        nome: f.nome.trim(), razao_social: nul(f.razao_social), cnpj: f.cnpj.trim() ? soDigitos(f.cnpj) : null,
        endereco: nul(f.endereco), bairro: nul(f.bairro), cidade: nul(f.cidade), uf: f.uf || null,
        cep: f.cep.trim() ? soDigitos(f.cep) : null, telefone: nul(f.telefone), email: nul(f.email),
      });
      avisar("Dados da agência salvos.");
      await ag.reload();
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Dados da agência"
        descricao="Aparecem no cabeçalho e no bloco da agência de todo Pedido de Inserção gerado a partir de agora."
      />
      <form className="formulario-pagina" onSubmit={salvar} noValidate>
        <fieldset className="grupo">
          <legend>Identificação</legend>
          <div className="grade-2">
            <Campo rotulo="Nome da agência" obrigatorio value={f.nome} onChange={(e) => set("nome", e.target.value)} erro={erros.nome} />
            <Campo rotulo="Razão social" value={f.razao_social} onChange={(e) => set("razao_social", e.target.value)} />
            <Campo rotulo="CNPJ" value={f.cnpj} inputMode="numeric" onChange={(e) => set("cnpj", e.target.value)}
              onBlur={() => set("cnpj", formatarCNPJ(f.cnpj))} erro={erros.cnpj} />
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>Endereço e contato</legend>
          <div className="grade-2">
            <Campo rotulo="Logradouro, número e complemento" className="span-2" value={f.endereco} onChange={(e) => set("endereco", e.target.value)} />
            <Campo rotulo="Bairro" value={f.bairro} onChange={(e) => set("bairro", e.target.value)} />
            <Campo rotulo="CEP" value={f.cep} inputMode="numeric" onChange={(e) => set("cep", e.target.value)}
              onBlur={() => set("cep", formatarCEP(f.cep))} erro={erros.cep} />
            <Campo rotulo="Cidade" value={f.cidade} onChange={(e) => set("cidade", e.target.value)}
              ajuda="Também é a cidade do campo de assinatura do P.I." />
            <CampoSelecao rotulo="UF" value={f.uf} onChange={(e) => set("uf", e.target.value)}>
              <option value="">Selecione</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </CampoSelecao>
            <Campo rotulo="Telefone" value={f.telefone} onChange={(e) => set("telefone", e.target.value)} />
            <Campo rotulo="E-mail" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </div>
        </fieldset>
        <div className="rodape-form">
          <span className="suave">Última alteração em {formatarDataHora(ag.data?.updated_at)}</span>
          <Botao type="submit" variante="primario" carregando={salvando}>Salvar dados da agência</Botao>
        </div>
      </form>
    </>
  );
}
