-- Custom migration (drizzle-kit does not model FORCE). Without FORCE the table
-- owner (monaco_owner) skips the policies; with it, RLS applies to every role
-- except superusers and BYPASSRLS roles (ADR 0003). Every tenant-owned table
-- needs the same statement in the migration that creates it.
ALTER TABLE "_tenancy_probe" FORCE ROW LEVEL SECURITY;
