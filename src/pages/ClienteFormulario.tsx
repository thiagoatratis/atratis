import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Alternador, Botao, Campo, CampoSelecao, Modal } from "../components/ui";
import { cnpjValido, emailValido, formatarCEP, formatarCNPJ, soDigitos, UFS } from "../lib/format";
import { atualizarCliente, criarCliente } from "../lib/api";
import type { Cliente, ClienteCampos } from "../types";

const opcional = (s: string) => (s.trim() ? s.trim() : null);

const esquema = z.object({
  nome_comercial: z.string().trim().min(1, "Informe o nome comercial.").max(200),
  razao_social: z.string().max(200),
  cnpj: z.string().refine((v) => !v.trim() || cnpjValido(v), "CNPJ inválido. Confira os 14 dígitos."),
  endereco: z.string().max(300),
  bairro: z.string().max(120),
  cidade: z.string().max(120),
  uf: z.string(),
  cep: z.string().refine((v) => !v.trim() || soDigitos(v).length === 8, "O CEP tem 8 dígitos."),
  telefone: z.string().max(40),
  email_contato: z.string().refine((v) => !v.trim() || emailValido(v), "E-mail inválido."),
  ativo: z.boolean(),
});
type Form = z.infer<typeof esquema>;

function inicial(c?: Cliente | null): Form {
  return {
    nome_comercial: c?.nome_comercial ?? "",
    razao_social: c?.razao_social ?? "",
    cnpj: c?.cnpj ? formatarCNPJ(c.cnpj) : "",
    endereco: c?.endereco ?? "",
    bairro: c?.bairro ?? "",
    cidade: c?.cidade ?? "",
    uf: c?.uf ?? "",
    cep: c?.cep ? formatarCEP(c.cep) : "",
    telefone: c?.telefone ?? "",
    email_contato: c?.email_contato ?? "",
    ativo: c?.ativo ?? true,
  };
}

export function ClienteFormulario({
  aberto, cliente, onFechar, onSalvo,
}: { aberto: boolean; cliente?: Cliente | null; onFechar: () => void; onSalvo: (c: Cliente) => void }) {
  const [form, setForm] = useState<Form>(() => inicial(cliente));
  const [erros, setErros] = useState<Partial<Record<keyof Form, string>>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [chave, setChave] = useState(cliente?.id ?? "novo");

  // Reinicia o formulário quando muda o cliente editado.
  if ((cliente?.id ?? "novo") !== chave) {
    setChave(cliente?.id ?? "novo");
    setForm(inicial(cliente));
    setErros({});
    setErroGeral(null);
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    const r = esquema.safeParse(form);
    if (!r.success) {
      const m: Partial<Record<keyof Form, string>> = {};
      for (const i of r.error.issues) m[i.path[0] as keyof Form] ??= i.message;
      setErros(m);
      return;
    }
    setErros({});
    const v = r.data;
    const campos: ClienteCampos = {
      nome_comercial: v.nome_comercial.trim(),
      razao_social: opcional(v.razao_social),
      cnpj: v.cnpj.trim() ? soDigitos(v.cnpj) : null,
      endereco: opcional(v.endereco),
      bairro: opcional(v.bairro),
      cidade: opcional(v.cidade),
      uf: v.uf || null,
      cep: v.cep.trim() ? soDigitos(v.cep) : null,
      telefone: opcional(v.telefone),
      email_contato: v.email_contato.trim() ? v.email_contato.trim().toLowerCase() : null,
      ativo: v.ativo,
    };
    setSalvando(true);
    try {
      const salvo = cliente ? await atualizarCliente(cliente.id, campos) : await criarCliente(campos);
      onSalvo(salvo);
    } catch (err) {
      setErroGeral(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={cliente ? `Editar ${cliente.nome_comercial}` : "Novo cliente"}
      onFechar={onFechar}
      largura={720}
      rodape={
        <>
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" type="submit" form="form-cliente" carregando={salvando}>
            {cliente ? "Salvar alterações" : "Cadastrar cliente"}
          </Botao>
        </>
      }
    >
      <form id="form-cliente" onSubmit={salvar} noValidate>
        {erroGeral && <div className="aviso aviso-erro" role="alert"><p>{erroGeral}</p></div>}
        <fieldset className="grupo">
          <legend>Identificação</legend>
          <div className="grade-2">
            <Campo rotulo="Nome comercial" obrigatorio value={form.nome_comercial}
              onChange={(e) => set("nome_comercial", e.target.value)} erro={erros.nome_comercial} />
            <Campo rotulo="Razão social" value={form.razao_social}
              onChange={(e) => set("razao_social", e.target.value)} erro={erros.razao_social}
              ajuda="Aparece no Pedido de Inserção." />
            <Campo rotulo="CNPJ" inputMode="numeric" value={form.cnpj} placeholder="00.000.000/0000-00"
              onChange={(e) => set("cnpj", e.target.value)}
              onBlur={() => set("cnpj", formatarCNPJ(form.cnpj))} erro={erros.cnpj} />
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>Endereço</legend>
          <div className="grade-2">
            <Campo rotulo="Logradouro, número e complemento" className="span-2" value={form.endereco}
              onChange={(e) => set("endereco", e.target.value)} placeholder="Av. Washington Soares, 909, Loja 42" />
            <Campo rotulo="Bairro" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} />
            <Campo rotulo="CEP" inputMode="numeric" value={form.cep} placeholder="00000-000"
              onChange={(e) => set("cep", e.target.value)}
              onBlur={() => set("cep", formatarCEP(form.cep))} erro={erros.cep} />
            <Campo rotulo="Cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
            <CampoSelecao rotulo="UF" value={form.uf} onChange={(e) => set("uf", e.target.value)}>
              <option value="">Selecione</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </CampoSelecao>
          </div>
        </fieldset>
        <fieldset className="grupo">
          <legend>Contato</legend>
          <div className="grade-2">
            <Campo rotulo="Telefone" type="tel" value={form.telefone}
              onChange={(e) => set("telefone", e.target.value)} placeholder="(85) 3216-7800" />
            <Campo rotulo="E-mail de contato" type="email" value={form.email_contato}
              onChange={(e) => set("email_contato", e.target.value)} erro={erros.email_contato} />
          </div>
        </fieldset>
        {cliente && (
          <Alternador
            marcado={form.ativo}
            onChange={(v) => set("ativo", v)}
            rotulo="Cliente ativo"
            descricao="Cliente inativo some para os aprovadores e não recebe novas solicitações."
          />
        )}
      </form>
    </Modal>
  );
}
