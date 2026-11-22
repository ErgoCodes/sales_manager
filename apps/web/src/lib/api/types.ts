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
export type ReportSummary = Schemas['ReportSummary_Output'];
export type SummaryTotals = Schemas['SummaryTotals_Output'];
export type DailySeries = Schemas['DailySeries_Output'];
export type TopProducts = Schemas['TopProducts_Output'];
export type SummaryByLocation = Schemas['SummaryByLocation_Output'];
export type InventoryHealth = Schemas['InventoryHealth_Output'];
