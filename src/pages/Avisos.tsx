import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { Botao } from "../components/ui";

function Tela({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="tela-aviso">
      <img src="/logo-atratis.png" alt="Atratis Digital" />
      <h1>{titulo}</h1>
      {children}
    </div>
  );
}

export function SemAcesso() {
  const { session, sair, erroPerfil } = useAuth();
  return (
    <Tela titulo="Acesso não liberado">
      <p>
        Você entrou como <strong>{session?.user.email}</strong>, mas este e-mail não tem acesso ativo ao sistema.
        Peça a um administrador da Atratis para liberar ou reativar o seu cadastro.
      </p>
      {erroPerfil && <p className="suave">Detalhe técnico: {erroPerfil}</p>}
      <Botao onClick={() => void sair()}>Sair e usar outro e-mail</Botao>
    </Tela>
  );
}

export function NaoConfigurado() {
  return (
    <Tela titulo="Falta conectar o Supabase">
      <p>
        Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env.local</code>
        (ou nas variáveis de ambiente da hospedagem) e recarregue a página. O passo a passo está no LEIA-ME do projeto.
      </p>
    </Tela>
  );
}

export function NaoEncontrada({ inicio }: { inicio: string }) {
  return (
    <div className="vazio">
      <p className="vazio-titulo">Página não encontrada</p>
      <div className="vazio-texto">O endereço pode estar errado ou a página mudou de lugar.</div>
      <div className="vazio-acao"><Link to={inicio} className="btn btn-secundario">Ir para o início</Link></div>
    </div>
  );
}
