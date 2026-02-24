import type Database from 'better-sqlite3';
import type { CompanyRow } from './companies.js';

export function addCompetitor(db: Database.Database, companyOrgId: string, competitorOrgId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO company_relations (company_org_id, competitor_org_id)
    VALUES (?, ?)
  `).run(companyOrgId, competitorOrgId);
}

export function removeCompetitor(db: Database.Database, companyOrgId: string, competitorOrgId: string): void {
  db.prepare('DELETE FROM company_relations WHERE company_org_id = ? AND competitor_org_id = ?')
    .run(companyOrgId, competitorOrgId);
}

export function getCompetitors(db: Database.Database, companyOrgId: string): CompanyRow[] {
  return db.prepare(`
    SELECT c.* FROM companies c
    JOIN company_relations cr ON cr.competitor_org_id = c.org_id
    WHERE cr.company_org_id = ?
    ORDER BY c.name
  `).all(companyOrgId) as CompanyRow[];
}
