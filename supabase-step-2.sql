-- Run after the initial Alivia schema.
create or replace function public.join_as_caregiver(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare invitation public.caregiver_invitations%rowtype;
begin
  select * into invitation from public.caregiver_invitations
  where invite_code = upper(trim(p_invite_code))
    and accepted_at is null and expires_at > now();
  if invitation.id is null then raise exception 'Código inválido o vencido'; end if;
  insert into public.care_members (care_space_id, user_id, role)
  values (invitation.care_space_id, auth.uid(), 'caregiver') on conflict do nothing;
  update public.caregiver_invitations set accepted_at = now() where id = invitation.id;
  return invitation.care_space_id;
end;
$$;
grant execute on function public.join_as_caregiver(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('medication-photos', 'medication-photos', false)
on conflict (id) do nothing;

create policy "users_upload_own_medication_photos" on storage.objects
for insert to authenticated with check (
  bucket_id = 'medication-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "users_read_own_medication_photos" on storage.objects
for select to authenticated using (
  bucket_id = 'medication-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
