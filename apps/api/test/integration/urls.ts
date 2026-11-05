export interface IntegrationUrls {
  /** Bootstrap superuser: seeds data across tenants. */
  admin: string;
  /** monaco_owner: schema owner (NOBYPASSRLS). */
  owner: string;
  /** monaco_app: the API's runtime role. */
  app: string;
}
