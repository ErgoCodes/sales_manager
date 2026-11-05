-- Custom migration (SP2·T3): what drizzle-kit does not model (ADR 0003, ADR 0004).

-- 1. tenants: monaco_app keeps SELECT, and UPDATE only on "name". Postgres
-- requires UPDATE on at least one column for SELECT ... FOR UPDATE (the
-- per-tenant mutex of the owner invariant, SP2·T4), and "name" is the only
-- column the app may ever change (tenant:manage). id, slug and created_at
-- stay read-only for the app.
REVOKE UPDATE ON "tenants" FROM monaco_app;--> statement-breakpoint
GRANT UPDATE ("name") ON "tenants" TO monaco_app;--> statement-breakpoint

-- 2. rate_limits: shared store of the throttler. It has no tenant, so instead
-- of the isolation policy it has RLS forced and NO policy (every role without
-- BYPASSRLS sees and writes nothing), and monaco_app gets no privilege on it.
-- The only door is rate_limit_hit(), SECURITY DEFINER owned by monaco_auth
-- (NOLOGIN BYPASSRLS), with a fixed search_path and EXECUTE for monaco_app only.
ALTER TABLE "rate_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "rate_limits" FROM monaco_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limits" TO monaco_auth;--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO monaco_auth;--> statement-breakpoint
SET ROLE monaco_auth;--> statement-breakpoint
-- Fixed window of p_ttl_ms. Over p_limit hits the key is blocked for
-- p_block_ms * 2^(strikes - 1), capped at p_max_block_ms (progressive backoff);
-- strikes reset 24 h after the last block ends. While blocked, hits are not
-- counted. Times come back in milliseconds.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key text, p_ttl_ms integer, p_limit integer, p_block_ms integer, p_max_block_ms integer
)
  RETURNS TABLE (total_hits integer, time_to_expire_ms bigint, is_blocked boolean, time_to_block_expire_ms bigint)
  LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_ttl interval := p_ttl_ms * interval '1 millisecond';
  r public.rate_limits%ROWTYPE;
BEGIN
  IF p_ttl_ms <= 0 OR p_limit < 0 OR p_block_ms < 0 OR p_max_block_ms < p_block_ms
     OR length(p_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limits (key, hits, window_expires_at)
  VALUES (p_key, 0, v_now + v_ttl)
  ON CONFLICT (key) DO NOTHING;
  SELECT * INTO r FROM public.rate_limits WHERE key = p_key FOR UPDATE;

  IF r.strikes_expire_at IS NOT NULL AND r.strikes_expire_at <= v_now THEN
    r.strikes := 0;
    r.strikes_expire_at := NULL;
  END IF;

  IF r.blocked_until IS NULL OR r.blocked_until <= v_now THEN
    IF r.blocked_until IS NOT NULL OR r.window_expires_at <= v_now THEN
      r.blocked_until := NULL;
      r.hits := 0;
      r.window_expires_at := v_now + v_ttl;
    END IF;
    r.hits := r.hits + 1;
    IF r.hits > p_limit AND p_block_ms > 0 THEN
      r.strikes := r.strikes + 1;
      r.blocked_until := v_now + least(p_block_ms * power(2, least(r.strikes, 20) - 1), p_max_block_ms) * interval '1 millisecond';
      r.strikes_expire_at := r.blocked_until + interval '24 hours';
    END IF;
  END IF;

  UPDATE public.rate_limits
  SET hits = r.hits, window_expires_at = r.window_expires_at, blocked_until = r.blocked_until,
      strikes = r.strikes, strikes_expire_at = r.strikes_expire_at
  WHERE key = p_key;

  -- Opportunistic cleanup of keys with nothing left to remember.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits
    WHERE window_expires_at < v_now
      AND (blocked_until IS NULL OR blocked_until < v_now)
      AND (strikes_expire_at IS NULL OR strikes_expire_at < v_now);
  END IF;

  RETURN QUERY SELECT
    r.hits,
    greatest(0, ceil(extract(epoch FROM r.window_expires_at - v_now) * 1000))::bigint,
    CASE WHEN p_block_ms > 0 THEN coalesce(r.blocked_until > v_now, false) ELSE r.hits > p_limit END,
    greatest(0, coalesce(ceil(extract(epoch FROM r.blocked_until - v_now) * 1000), 0))::bigint;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer, integer, integer) TO monaco_app;--> statement-breakpoint
RESET ROLE;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM monaco_auth;
