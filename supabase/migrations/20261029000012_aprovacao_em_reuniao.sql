-- =====================================================================
-- Atratis Approval · Aprovação em reunião e P.I.s por e-mail
--
-- Decisões de 29/10/2026:
--   * A equipe registra que o cliente aprovou em reunião (orçamentos, planos
--     e criativos), informando data e hora da reunião, quem aprovou pelo
--     cliente e uma observação. A decisão fica no histórico com o nome de
--     quem registrou e aparece para o cliente como "aprovado em reunião".
--   * Se ainda não tinha sido enviado, o registro já envia (o cliente passa
--     a ver o que foi aprovado).
--   * Os P.I.s podem ir por e-mail pelo sistema (Gmail da Atratis) ou pelo
--     e-mail de quem envia; o envio pelo sistema fica registrado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas da reunião nas três tabelas de decisão
-- ---------------------------------------------------------------------

alter table public.budget_approvals
  add column via text not null default 'portal',
  add column reuniao_em timestamptz,
  add column aprovado_por_cliente text,
  add column observacao_reuniao text,
  add constraint budget_approvals_via_chk check (via in ('portal', 'reuniao')),
  add constraint budget_approvals_reuniao_chk check (
    via = 'portal' or (reuniao_em is not null and length(btrim(coalesce(aprovado_por_cliente, ''))) >= 2));

alter table public.approvals
  add column via text not null default 'portal',
  add column reuniao_em timestamptz,
  add column aprovado_por_cliente text,
  add column observacao_reuniao text,
  add constraint approvals_via_chk check (via in ('portal', 'reuniao')),
  add constraint approvals_reuniao_chk check (
    via = 'portal' or (reuniao_em is not null and length(btrim(coalesce(aprovado_por_cliente, ''))) >= 2));

alter table public.plan_section_decisions
  add column via text not null default 'portal',
  add column reuniao_em timestamptz,
  add column aprovado_por_cliente text,
  add column observacao_reuniao text,
  add constraint plan_decisions_via_chk check (via in ('portal', 'reuniao')),
  add constraint plan_decisions_reuniao_chk check (
    via = 'portal' or (reuniao_em is not null and length(btrim(coalesce(aprovado_por_cliente, ''))) >= 2));

-- Confere os dados da reunião.
create or replace function private.validar_reuniao(p_reuniao_em timestamptz, p_aprovado_por text, p_observacao text)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_reuniao_em is null then
    raise exception 'Informe a data e a hora da reunião.' using errcode = 'P0001';
  end if;
  if p_reuniao_em > now() + interval '10 minutes' then
    raise exception 'A reunião não pode estar no futuro.' using errcode = 'P0001';
  end if;
  if p_reuniao_em < now() - interval '1 year' then
    raise exception 'A data da reunião está muito antiga. Confira o ano.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_aprovado_por, ''))) < 2 or length(p_aprovado_por) > 120 then
    raise exception 'Informe quem aprovou pelo cliente.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_observacao, '')) > 1000 then
    raise exception 'Observação muito longa (máximo 1.000 caracteres).' using errcode = 'P0001';
  end if;
end;
$$;
grant execute on function private.validar_reuniao(timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Orçamento
-- ---------------------------------------------------------------------

create or replace function public.aprovar_orcamento_em_reuniao(
  p_budget uuid, p_reuniao_em timestamptz, p_aprovado_por text, p_observacao text default null)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_v public.budget_versions%rowtype;
  v_eu public.profiles%rowtype;
  v_total numeric(14, 2);
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status = 'cancelado' then
    raise exception 'Orçamento cancelado não pode ser aprovado.' using errcode = 'P0001';
  end if;
  perform private.validar_reuniao(p_reuniao_em, p_aprovado_por, p_observacao);

  select * into v_v from public.budget_versions where id = private.versao_atual_orcamento(p_budget);
  if v_v.status = 'rascunho' then
    perform public.enviar_orcamento(p_budget);
    select * into v_v from public.budget_versions where id = v_v.id;
  end if;
  if v_v.status = 'aprovado' then
    raise exception 'Este orçamento já está aprovado.' using errcode = 'P0001';
  end if;
  if v_v.status not in ('pendente', 'alteracoes_solicitadas') then
    raise exception 'Este orçamento não pode ser aprovado agora.' using errcode = 'P0001';
  end if;

  select coalesce(sum(valor), 0) into v_total from public.budget_lines where version_id = v_v.id;
  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.budget_approvals (version_id, budget_id, client_id, decisao, total, user_id, user_email, user_nome,
                                       via, reuniao_em, aprovado_por_cliente, observacao_reuniao)
  values (v_v.id, v_b.id, v_b.client_id, 'aprovado', v_total, v_eu.id, v_eu.email, v_eu.nome,
          'reuniao', p_reuniao_em, btrim(p_aprovado_por), nullif(btrim(coalesce(p_observacao, '')), ''));

  perform set_config('app.transicao', 'on', true);
  update public.budget_versions set status = 'aprovado', decidido_em = now() where id = v_v.id;
  update public.budgets set status = 'aprovado', concluido_em = now() where id = v_b.id;
  perform set_config('app.transicao', '', true);
  return 'aprovado';
end;
$$;

-- ---------------------------------------------------------------------
-- Plano: aprova todas as seções que faltam (pendentes ou com ajuste pedido)
-- ---------------------------------------------------------------------

create or replace function public.aprovar_plano_em_reuniao(
  p_plan uuid, p_reuniao_em timestamptz, p_aprovado_por text, p_observacao text default null)
returns public.plano_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.plans%rowtype;
  v_v public.plan_versions%rowtype;
  v_eu public.profiles%rowtype;
  v_n integer;
begin
  select * into v_p from public.plans where id = p_plan for update;
  if not found or not private.staff_pode_plano(p_plan) then
    raise exception 'Plano não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_p.status = 'cancelado' then
    raise exception 'Plano cancelado não pode ser aprovado.' using errcode = 'P0001';
  end if;
  if v_p.status = 'aprovado' then
    raise exception 'Este plano já está aprovado.' using errcode = 'P0001';
  end if;
  perform private.validar_reuniao(p_reuniao_em, p_aprovado_por, p_observacao);

  select * into v_v from public.plan_versions where id = private.versao_atual_plano(p_plan);
  if v_v.status = 'rascunho' then
    perform public.enviar_plano(p_plan);
    select * into v_v from public.plan_versions where id = v_v.id;
  end if;
  if v_v.status not in ('pendente', 'concluida') then
    raise exception 'Este plano não pode ser aprovado agora.' using errcode = 'P0001';
  end if;

  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.plan_section_decisions (section_id, version_id, plan_id, client_id, secao_nome, decisao,
                                             user_id, user_email, user_nome,
                                             via, reuniao_em, aprovado_por_cliente, observacao_reuniao)
  select s.id, v_v.id, v_p.id, v_p.client_id, s.nome, 'aprovada', v_eu.id, v_eu.email, v_eu.nome,
         'reuniao', p_reuniao_em, btrim(p_aprovado_por), nullif(btrim(coalesce(p_observacao, '')), '')
    from public.plan_sections s
   where s.version_id = v_v.id and s.status in ('pendente', 'ajuste_solicitado');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Não há seção para aprovar neste plano.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.plan_sections set status = 'aprovada', decidido_em = now()
   where version_id = v_v.id and status in ('pendente', 'ajuste_solicitado');
  update public.plan_versions set status = 'concluida', decidido_em = now() where id = v_v.id;
  update public.plans set status = 'aprovado', concluido_em = now() where id = v_p.id;
  perform set_config('app.transicao', '', true);
  return 'aprovado';
end;
$$;

-- ---------------------------------------------------------------------
-- Criativos: aprova as peças ativas que faltam (envia as que eram rascunho)
-- ---------------------------------------------------------------------

create or replace function public.aprovar_solicitacao_em_reuniao(
  p_request uuid, p_reuniao_em timestamptz, p_aprovado_por text, p_observacao text default null)
returns public.solicitacao_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.creative_requests%rowtype;
  v_eu public.profiles%rowtype;
  v_n integer;
  v_novo public.solicitacao_status;
begin
  select * into v_r from public.creative_requests where id = p_request for update;
  if not found or not private.staff_pode_request(p_request) then
    raise exception 'Solicitação não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  if v_r.status = 'cancelado' then
    raise exception 'Solicitação cancelada não pode ser aprovada.' using errcode = 'P0001';
  end if;
  perform private.validar_reuniao(p_reuniao_em, p_aprovado_por, p_observacao);

  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.approvals (version_id, piece_id, request_id, client_id, decisao, user_id, user_email, user_nome,
                                via, reuniao_em, aprovado_por_cliente, observacao_reuniao)
  select va.version_id, va.piece_id, v_r.id, v_r.client_id, 'aprovado', v_eu.id, v_eu.email, v_eu.nome,
         'reuniao', p_reuniao_em, btrim(p_aprovado_por), nullif(btrim(coalesce(p_observacao, '')), '')
    from private.versoes_atuais(p_request) va
   where va.status in ('rascunho', 'pendente', 'alteracoes_solicitadas');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Não há peça para aprovar nesta solicitação.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.piece_versions v
     set status = 'aprovado', decidido_em = now(), enviado_em = coalesce(v.enviado_em, now())
   where v.id in (select version_id from private.versoes_atuais(p_request)
                   where status in ('rascunho', 'pendente', 'alteracoes_solicitadas'));
  update public.creative_requests
     set enviado_em = coalesce(enviado_em, now()), visualizado_em = coalesce(visualizado_em, now())
   where id = p_request;
  v_novo := private.status_calculado(p_request);
  update public.creative_requests
     set status = v_novo,
         concluido_em = case when v_novo in ('aprovado', 'alteracoes_solicitadas') then now() else null end
   where id = p_request;
  perform set_config('app.transicao', '', true);
  return v_novo;
end;
$$;

revoke all on function public.aprovar_orcamento_em_reuniao(uuid, timestamptz, text, text),
  public.aprovar_plano_em_reuniao(uuid, timestamptz, text, text),
  public.aprovar_solicitacao_em_reuniao(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.aprovar_orcamento_em_reuniao(uuid, timestamptz, text, text),
  public.aprovar_plano_em_reuniao(uuid, timestamptz, text, text),
  public.aprovar_solicitacao_em_reuniao(uuid, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Registro dos P.I.s enviados por e-mail pelo sistema
-- (gravado só pela função de servidor "enviar-pis", com a chave de serviço)
-- ---------------------------------------------------------------------

create table public.pi_envios (
  id               bigint generated always as identity primary key,
  budget_id        uuid not null references public.budgets (id) on delete restrict,
  client_id        uuid not null references public.clients (id) on delete restrict,
  pis              uuid[] not null,
  numeros          text[] not null,
  para             text[] not null,
  assunto          text not null,
  enviado_por      uuid,
  enviado_por_nome text,
  created_at       timestamptz not null default now()
);
create index pi_envios_budget_idx on public.pi_envios (budget_id, created_at desc);
create trigger pi_envios_immutable before update or delete on public.pi_envios
  for each row execute function private.registro_imutavel();
create trigger pi_envios_audit after insert on public.pi_envios
  for each row execute function private.audit_row('pi.email', 'client_id');

alter table public.pi_envios enable row level security;
create policy pi_envios_select on public.pi_envios for select to authenticated
  using (private.staff_pode_orcamento(budget_id));
revoke all on public.pi_envios from anon;
revoke insert, update, delete, truncate on public.pi_envios from authenticated;
