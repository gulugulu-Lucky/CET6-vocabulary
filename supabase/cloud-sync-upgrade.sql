-- Run once in Supabase SQL Editor. Existing records and RLS stay intact.
begin;
create or replace function public.cet6_stamp_study_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists cet6_study_stamp on public.study_records;
create trigger cet6_study_stamp before insert or update on public.study_records
for each row execute function public.cet6_stamp_study_record();
create index if not exists cet6_study_delta_idx on public.study_records(user_id, updated_at, record_key);
create or replace function public.cet6_sync_batch(changes jsonb)
returns table(record_key text, record_data jsonb, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; uid uuid := auth.uid(); 
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>100 then raise exception 'Invalid batch'; end if;
 for item in select value from jsonb_array_elements(changes) loop
  if item->>'record_key' is null or jsonb_typeof(item->'record_data') is distinct from 'object' then raise exception 'Invalid record'; end if;
  if (item->>'exists')::boolean then
   return query update public.study_records as r set record_data=item->'record_data'
   where r.user_id=uid and r.record_key=item->>'record_key'
   and (r.record_data->>'at') is not distinct from (item->>'expected')
   returning r.record_key,r.record_data,r.updated_at;
  else
   return query insert into public.study_records as r(user_id,record_key,record_data)
   values(uid,item->>'record_key',item->'record_data')
   on conflict on constraint study_records_pkey do nothing
   returning r.record_key,r.record_data,r.updated_at;
  end if;
 end loop;
end;
$$;
revoke all on function public.cet6_sync_batch(jsonb) from public, anon;
grant execute on function public.cet6_sync_batch(jsonb) to authenticated;
commit;
