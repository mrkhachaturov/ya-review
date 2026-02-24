export interface Review {
  author_name: string | null;
  author_icon_url: string | null;
  author_profile_url: string | null;
  date: string | null;
  text: string | null;
  stars: number;
  likes: number;
  dislikes: number;
  review_url: string | null;
  business_response: string | null;
}

export interface CompanyInfo {
  name: string | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  categories: string[];
}

export interface ScrapeResult {
  company: CompanyInfo;
  reviews: Review[];
  total_count: number;
}

export interface SyncResult {
  org_id: string;
  sync_type: 'full' | 'incremental';
  reviews_added: number;
  reviews_updated: number;
  started_at: string;
  finished_at: string;
  status: 'ok' | 'error';
  error_message?: string;
}

export type CompanyRole = 'mine' | 'competitor' | 'tracked';
export type BrowserBackend = 'patchright' | 'playwright' | 'remote';
