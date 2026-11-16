import type { components } from './schema';

type Schemas = components['schemas'];
export type Location = Schemas['Location_Output'];
export type Role = Schemas['Role_Output'];
export type User = Schemas['User_Output'];
export type UserDetail = Schemas['UserDetail_Output'];
export type Device = Schemas['Device_Output'];
export type AuditEvent = Schemas['AuditEvent_Output'];
