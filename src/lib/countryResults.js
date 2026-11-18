// Results-by-country data for the admin report (AdminCountryResults.jsx)
// and AdminQuestionTrend's XLSX/PDF exports. Backed by
// get_question_country_results() (migration 114).

import { countryName } from "./countries";

export const VERIFIED_EXPLANATION =
  "Verified = the respondent's chosen country matches the country of their verified phone number.";

export function countryLabel(code) {
  return code ? countryName(code) : "Not set";
}

// Shared with AdminQuestionTrend's exports. asOf (a Date, optional)
// limits the counts to votes cast up to that moment.
export async function fetchCountryResults(supabase, questionId, asOf) {
  const { data, error } = await supabase.rpc("get_question_country_results", {
    p_question_id: questionId,
    p_as_of: asOf ? asOf.toISOString() : null,
  });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    ...r,
    respondents: Number(r.respondents),
    verified_respondents: Number(r.verified_respondents),
    yes_count: Number(r.yes_count),
    ly_count: Number(r.ly_count),
    ln_count: Number(r.ln_count),
    no_count: Number(r.no_count),
    verified_yes_count: Number(r.verified_yes_count),
    verified_ly_count: Number(r.verified_ly_count),
    verified_ln_count: Number(r.verified_ln_count),
    verified_no_count: Number(r.verified_no_count),
    pct_yes_side: r.pct_yes_side == null ? null : Number(r.pct_yes_side),
    verified_pct_yes_side: r.verified_pct_yes_side == null ? null : Number(r.verified_pct_yes_side),
  }));
}

// Picks the "all" or "verified" figures out of a row.
export function rowFigures(row, verifiedOnly) {
  return verifiedOnly
    ? {
        respondents: row.verified_respondents,
        yes: row.verified_yes_count,
        ly: row.verified_ly_count,
        ln: row.verified_ln_count,
        no: row.verified_no_count,
        pctYesSide: row.verified_pct_yes_side,
      }
    : {
        respondents: row.respondents,
        yes: row.yes_count,
        ly: row.ly_count,
        ln: row.ln_count,
        no: row.no_count,
        pctYesSide: row.pct_yes_side,
      };
}
