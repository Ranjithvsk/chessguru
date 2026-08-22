// Types shared by every page. `Tournament` mirrors the Mongo shape returned by
// GET /v2api/api/play/tournaments (and its cousins /tournament, /me/feed).
export interface Tournament {
  _id: string;
  source?: string;
  source_url?: string | null;
  name: string;
  organizer_name?: string;
  location_raw?: string;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  maps_url?: string | null;
  start_date?: string;
  end_date?: string;
  format?: "CLASSICAL" | "RAPID" | "BLITZ";
  rating_type?: "FIDE" | "AICF" | "STATE" | "UNRATED";
  age_categories?: Array<number | string>;
  entry_fee_paise?: number | null;
  prize_pool_paise?: number | null;
  contact_phones?: string[];
  contact_person?: string | null;
  contact_email?: string | null;
  prospectus_url?: string | null;
  register_url?: string | null;
  lat?: number;
  lng?: number;
  distance_km?: number | null;
  matched_players?: Array<{ name: string; age: number }>;
  submitted_at?: string;
  submission_status?: "PENDING_REVIEW" | "VERIFIED";
  hidden?: boolean;
}

export interface Stats { academies?: number; students?: number; coaches?: number; puzzlesSolvedWeek?: number; }
