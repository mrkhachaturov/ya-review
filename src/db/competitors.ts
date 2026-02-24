import type { DbClient } from './driver.js';
import type { CompanyRow } from './companies.js';

export async function addCompetitor(db: DbClient, companyOrgId: string, competitorOrgId: string): Promise<void> {
  await db.run(`
    INSERT OR IGNORE INTO company_relations (company_org_id, competitor_org_id)
    VALUES (?, ?)
  `, [companyOrgId, competitorOrgId]);
}

export async function removeCompetitor(db: DbClient, companyOrgId: string, competitorOrgId: string): Promise<void> {
  await db.run(
    'DELETE FROM company_relations WHERE company_org_id = ? AND competitor_org_id = ?',
    [companyOrgId, competitorOrgId],
  );
}

export async function getCompetitors(db: DbClient, companyOrgId: string): Promise<CompanyRow[]> {
  return db.all<CompanyRow>(`
    SELECT c.* FROM companies c
    JOIN company_relations cr ON cr.competitor_org_id = c.org_id
    WHERE cr.company_org_id = ?
    ORDER BY c.name
  `, [companyOrgId]);
}
