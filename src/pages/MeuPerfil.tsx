import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { atualizarMeuNome } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Botao, CabecalhoPagina, Campo, useAviso } from "../components/ui";
import { PERFIL_ROTULO } from "../types";

export function MeuPerfil() {
  const { perfil, recarregarPerfil } = useAuth();
  const avisar = useAviso();
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  if (!perfil) return null;
  const interno = perfil.role !== "cliente";

  async function salvarNome(e: FormEvent) {
    e.preventDefault();
    if (!perfil) return;
    setSalvandoNome(true);
    try {
      await atualizarMeuNome(perfil.id, nome);
      await recarregarPerfil();
      avisar("Nome atualizado.");
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
    } finally {
      setSalvandoNome(false);
    }
  }

  async function salvarSenha(e: FormEvent) {
    e.preventDefault();
    setErroSenha(null);
    if (senha.length < 10) return setErroSenha("Use pelo menos 10 caracteres.");
    if (senha !== senha2) return setErroSenha("As duas senhas não são iguais.");
    setSalvandoSenha(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvandoSenha(false);
    if (error) {
      setErroSenha(/reauth|recent/i.test(error.message)
        ? "Por segurança, saia, entre de novo pelo link do e-mail e defina a senha logo em seguida."
        : error.message);
      return;
    }
    setSenha(""); setSenha2("");
    avisar("Senha definida. Você pode entrar com ela ou continuar usando o link por e-mail.");
  }

  return (
    <>
      <CabecalhoPagina titulo="Meu perfil" descricao={`Você entra como ${perfil.email}. Perfil: ${PERFIL_ROTULO[perfil.role]}.`} />
      <form className="formulario-pagina estreito" onSubmit={salvarNome}>
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} ajuda="É assim que você aparece no histórico de aprovações." />
        <div><Botao type="submit" variante="primario" carregando={salvandoNome} disabled={nome.trim() === (perfil.nome ?? "")}>Salvar nome</Botao></div>
      </form>
      {interno && (
        <form className="formulario-pagina estreito" onSubmit={salvarSenha} noValidate>
          <h2 className="titulo-secao">Senha (opcional)</h2>
          <p className="suave">O link por e-mail continua funcionando. A senha é só um atalho para quem entra todo dia.</p>
          <Campo rotulo="Nova senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <Campo rotulo="Repita a senha" type="password" autoComplete="new-password" value={senha2}
            onChange={(e) => setSenha2(e.target.value)} erro={erroSenha} />
          <div><Botao type="submit" carregando={salvandoSenha} disabled={!senha}>Definir senha</Botao></div>
        </form>
      )}
    </>
  );
}
