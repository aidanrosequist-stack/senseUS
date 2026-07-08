import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (_req) => {
  try {
    // Get all user IDs
    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, streak_days")

    if (profilesError) throw profilesError

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    let updated = 0

    for (const profile of profiles) {
      // Count votes in last 30 days
      const { count: voteCount } = await adminClient
        .from("votes")
        .select("*", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .gte("created_at", thirtyDaysAgo)

      // Count comments in last 30 days
      const { count: commentCount } = await adminClient
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .eq("is_deleted", false)
        .gte("created_at", thirtyDaysAgo)

      // Calculate integrity weight
      let weight = 1.0000

      // Vote thresholds (cumulative)
      if ((voteCount || 0) >= 10) weight += 0.0005
      if ((voteCount || 0) >= 25) weight += 0.0010
      if ((voteCount || 0) >= 50) weight += 0.0020

      // Comment thresholds (cumulative)
      if ((commentCount || 0) >= 5) weight += 0.0005
      if ((commentCount || 0) >= 10) weight += 0.0005

      // Streak bonus
      if ((profile.streak_days || 0) >= 7) weight += 0.0005

      // Cap at 1.0050
      weight = Math.min(weight, 1.0050)

      // Round to 4 decimal places
      weight = Math.round(weight * 10000) / 10000

      // Update profile
      await adminClient
        .from("profiles")
        .update({ integrity_weight: weight })
        .eq("id", profile.id)

      updated++
    }

    return new Response(
      JSON.stringify({ success: true, profiles_updated: updated }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    )
  }
})