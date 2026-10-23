import { useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { RouterProvider, matchPath, useRouter } from "./lib/router";
import { supabaseConfigurado } from "./lib/supabase";
import { Carregando, ToastProvider } from "./components/ui";
import { ShellCliente, ShellInterno } from "./components/Shell";
import { Entrar } from "./pages/Entrar";
import { Clientes } from "./pages/Clientes";
import { ClienteDetalhe } from "./pages/ClienteDetalhe";
import { Usuarios } from "./pages/Usuarios";
import { Configuracoes } from "./pages/Configuracoes";
import { Historico } from "./pages/Historico";
import { MeuPerfil } from "./pages/MeuPerfil";
import { Portal } from "./pages/Portal";
import { Criativos } from "./pages/Criativos";
import { SolicitacaoDetalhe } from "./pages/SolicitacaoDetalhe";
import { AprovacaoCliente } from "./pages/AprovacaoCliente";
import { NaoConfigurado, NaoEncontrada, SemAcesso } from "./pages/Avisos";

function Redirecionar({ para }: { para: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(para, { replace: true }), [navigate, para]);
  return null;
}

function RotasInternas() {
  const { path } = useRouter();
  const { perfil } = useAuth();
  const admin = perfil?.role === "admin";
  let pagina: ReactNode;
  let m: Record<string, string> | null;

  if (path === "/" ) pagina = <Redirecionar para="/clientes" />;
  else if (path === "/clientes") pagina = <Clientes />;
  else if ((m = matchPath("/clientes/:id", path))) pagina = <ClienteDetalhe key={m.id} id={m.id} />;
  else if (path === "/criativos") pagina = <Criativos />;
  else if ((m = matchPath("/criativos/:id", path))) pagina = <SolicitacaoDetalhe key={m.id} id={m.id} />;
  // Link do cliente aberto por alguém da equipe: leva para a mesma solicitação na visão interna.
  else if ((m = matchPath("/aprovacoes/:id", path))) pagina = <Redirecionar para={`/criativos/${m.id}`} />;
  else if (path === "/perfil") pagina = <MeuPerfil />;
  else if (admin && path === "/usuarios") pagina = <Usuarios />;
  else if (admin && path === "/historico") pagina = <Historico />;
  else if (admin && path === "/configuracoes") pagina = <Configuracoes />;
  else pagina = <NaoEncontrada inicio="/clientes" />;

  return <ShellInterno>{pagina}</ShellInterno>;
}

function RotasCliente() {
  const { path } = useRouter();
  let pagina: ReactNode;
  let m: Record<string, string> | null;
  if (path === "/") pagina = <Portal />;
  else if ((m = matchPath("/aprovacoes/:id", path))) pagina = <AprovacaoCliente key={m.id} id={m.id} />;
  else if (path === "/perfil") pagina = <MeuPerfil />;
  else pagina = <NaoEncontrada inicio="/" />;
  return <ShellCliente>{pagina}</ShellCliente>;
}

function Raiz() {
  const { carregando, session, perfil } = useAuth();
  if (!supabaseConfigurado) return <NaoConfigurado />;
  if (carregando) return <div className="tela-cheia"><Carregando texto="Abrindo…" /></div>;
  if (!session) return <Entrar />;
  if (!perfil || !perfil.ativo) return <SemAcesso />;
  return perfil.role === "cliente" ? <RotasCliente /> : <RotasInternas />;
}

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <Raiz />
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  );
}
