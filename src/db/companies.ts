import type Database from 'better-sqlite3';
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

export function upsertCompany(db: Database.Database, input: UpsertCompanyInput): void {
  const cats = input.categories ? JSON.stringify(input.categories) : null;
  db.prepare(`
    INSERT INTO companies (org_id, name, rating, review_count, address, categories, role)
    VALUES (@org_id, @name, @rating, @review_count, @address, @categories, @role)
    ON CONFLICT(org_id) DO UPDATE SET
      name = COALESCE(@name, companies.name),
      rating = COALESCE(@rating, companies.rating),
      review_count = COALESCE(@review_count, companies.review_count),
      address = COALESCE(@address, companies.address),
      categories = COALESCE(@categories, companies.categories),
      role = @role,
      updated_at = datetime('now')
  `).run({
    org_id: input.org_id,
    name: input.name ?? null,
    rating: input.rating ?? null,
    review_count: input.review_count ?? null,
    address: input.address ?? null,
    categories: cats,
    role: input.role ?? 'tracked',
  });
}

export function getCompany(db: Database.Database, orgId: string): CompanyRow | undefined {
  return db.prepare('SELECT * FROM companies WHERE org_id = ?').get(orgId) as CompanyRow | undefined;
}

export function listCompanies(db: Database.Database, role?: CompanyRole): CompanyRow[] {
  if (role) {
    return db.prepare('SELECT * FROM companies WHERE role = ? ORDER BY name').all(role) as CompanyRow[];
  }
  return db.prepare('SELECT * FROM companies ORDER BY name').all() as CompanyRow[];
}

export function removeCompany(db: Database.Database, orgId: string): void {
  db.prepare('DELETE FROM reviews WHERE org_id = ?').run(orgId);
  db.prepare('DELETE FROM company_relations WHERE company_org_id = ? OR competitor_org_id = ?').run(orgId, orgId);
  db.prepare('DELETE FROM sync_log WHERE org_id = ?').run(orgId);
  db.prepare('DELETE FROM companies WHERE org_id = ?').run(orgId);
}
