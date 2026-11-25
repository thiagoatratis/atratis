-- =====================================================================
-- Atratis Approval · Voltar peça retirada para a aprovação
--
-- 25/11/2026: a equipe retirou uma peça sem querer e não havia como
-- desfazer pela tela. A peça volta como estava (a versão que já tinha sido
-- enviada continua com a mesma decisão ou aguardando o cliente) e a situação
-- da solicitação é recalculada. Fica na auditoria como mudança da peça.
-- =====================================================================

create or replace function public.voltar_peca(p_piece uuid)
returns public.solicitacao_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_req uuid := private.piece_request(p_piece);
  v_r public.creative_requests%rowtype;
  v_novo public.solicitacao_status;
begin
  if v_req is null or not private.staff_pode_request(v_req) then
    raise exception 'Peça não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  select * into v_r from public.creative_requests where id = v_req for update;
  if v_r.status = 'cancelado' then
    raise exception 'Solicitação cancelada não pode ser alterada.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.creative_pieces where id = p_piece and ativo) then
    raise exception 'Esta peça já está na aprovação.' using errcode = 'P0001';
  end if;

  update public.creative_pieces set ativo = true where id = p_piece;
  v_novo := v_r.status;
  if v_r.status <> 'rascunho' then
    perform set_config('app.transicao', 'on', true);
    v_novo := private.status_calculado(v_req);
    update public.creative_requests
       set status = v_novo,
           concluido_em = case when v_novo in ('aprovado', 'alteracoes_solicitadas') then coalesce(concluido_em, now()) else null end
     where id = v_req;
    perform set_config('app.transicao', '', true);
  end if;
  return v_novo;
end;
$$;

revoke all on function public.voltar_peca(uuid) from public, anon;
grant execute on function public.voltar_peca(uuid) to authenticated;
