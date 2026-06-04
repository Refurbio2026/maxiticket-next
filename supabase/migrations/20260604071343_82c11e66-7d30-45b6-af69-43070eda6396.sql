-- Add unique scanner token to events for public scanner access (no login required)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS scanner_token text;

-- Backfill existing rows with a random token
UPDATE public.events
SET scanner_token = encode(gen_random_bytes(18), 'base64')
WHERE scanner_token IS NULL;

-- Normalize tokens to URL-safe characters
UPDATE public.events
SET scanner_token = replace(replace(replace(scanner_token, '+', '-'), '/', '_'), '=', '')
WHERE scanner_token ~ '[+/=]';

-- Enforce uniqueness + default for new rows
ALTER TABLE public.events
  ALTER COLUMN scanner_token SET NOT NULL,
  ALTER COLUMN scanner_token SET DEFAULT replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', '-'), '/', '_'), '=', '');

CREATE UNIQUE INDEX IF NOT EXISTS events_scanner_token_key ON public.events (scanner_token);