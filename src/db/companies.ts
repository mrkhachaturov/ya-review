import type { DbClient } from './driver.js';
import type { CompanyRole } from '../types/index.js';

export interface CompanyRow {
  id: number;
  org_id: string;
  name: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  categories: string | null;
  role: CompanyRole;
  created_at: string;
  updated_at: string;
}

export interface UpsertCompanyInput {
  org_id: string;
  name?: string | null;
  rating?: number | null;
  review_count?: number | null;
  address?: string | null;
  categories?: string[];
  role?: CompanyRole;
}

export async function upsertCompany(db: DbClient, input: UpsertCompanyInput): Promise<void> {
  const cats = input.categories ? JSON.stringify(input.categories) : null;
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO companies (org_id, name, rating, review_count, address, categories, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id) DO UPDATE SET
      name = COALESCE(?, companies.name),
      rating = COALESCE(?, companies.rating),
      review_count = COALESCE(?, companies.review_count),
      address = COALESCE(?, companies.address),
      categories = COALESCE(?, companies.categories),
      role = ?,
      updated_at = ?
  `, [
    input.org_id,
    input.name ?? null,
    input.rating ?? null,
    input.review_count ?? null,
    input.address ?? null,
    cats,
    input.role ?? 'tracked',
    input.name ?? null,
    input.rating ?? null,
    input.review_count ?? null,
    input.address ?? null,
    cats,
    input.role ?? 'tracked',
    now,
  ]);
}

export async function getCompany(db: DbClient, orgId: string): Promise<CompanyRow | undefined> {
  return db.get<CompanyRow>('SELECT * FROM companies WHERE org_id = ?', [orgId]);
}

export async function listCompanies(db: DbClient, role?: CompanyRole): Promise<CompanyRow[]> {
  if (role) {
    return db.all<CompanyRow>('SELECT * FROM companies WHERE role = ? ORDER BY name', [role]);
  }
  return db.all<CompanyRow>('SELECT * FROM companies ORDER BY name');
}

export async function removeCompany(db: DbClient, orgId: string): Promise<void> {
  await db.run('DELETE FROM reviews WHERE org_id = ?', [orgId]);
  await db.run('DELETE FROM company_relations WHERE company_org_id = ? OR competitor_org_id = ?', [orgId, orgId]);
  await db.run('DELETE FROM sync_log WHERE org_id = ?', [orgId]);
  await db.run('DELETE FROM companies WHERE org_id = ?', [orgId]);
}
