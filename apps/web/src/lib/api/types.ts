import type { components } from './schema';

type Schemas = components['schemas'];
export type Location = Schemas['Location_Output'];
export type Role = Schemas['Role_Output'];
export type User = Schemas['User_Output'];
export type UserDetail = Schemas['UserDetail_Output'];
export type Device = Schemas['Device_Output'];
export type AuditEvent = Schemas['AuditEvent_Output'];
export type StockItem = Schemas['StockItem_Output'];
export type InventoryMovement = Schemas['InventoryMovement_Output'];
export type InventoryDocument = Schemas['InventoryDocument_Output'];
