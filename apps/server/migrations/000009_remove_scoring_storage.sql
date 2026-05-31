do $$
begin
  if to_regclass('price_ticks') is not null then
    perform remove_retention_policy('price_ticks'::regclass, if_exists => true);
    perform remove_compression_policy('price_ticks'::regclass, if_exists => true);
  end if;

  if to_regclass('score_snapshots') is not null then
    perform remove_retention_policy('score_snapshots'::regclass, if_exists => true);
    perform remove_compression_policy('score_snapshots'::regclass, if_exists => true);
  end if;
exception
  when undefined_function then
    null;
end $$;

drop table if exists score_evidence cascade;
drop table if exists coin_score_current cascade;
drop table if exists score_snapshots cascade;
drop table if exists score_config_versions cascade;
drop table if exists forward_returns cascade;
drop table if exists price_ticks cascade;
