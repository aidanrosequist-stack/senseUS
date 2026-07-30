import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const number = url.searchParams.get("number")

  if (!number) {
    return new Response("Missing question number", { status: 400 })
  }

  try {
    const { data: question } = await adminClient
      .from("questions")
      .select("text, category, question_number")
      .eq("question_number", parseInt(number, 10))
      .single()

    if (!question) {
      return new Response("Question not found", { status: 404 })
    }

    // Get vote tally
    const { data: votes } = await adminClient
      .from("votes")
      .select("choice")
      .eq("question_id", question.id)

    const counts = { yes: 0, ly: 0, ln: 0, no: 0 }
    ;(votes || []).forEach((v: any) => {
      if (counts[v.choice as keyof typeof counts] !== undefined) {
        counts[v.choice as keyof typeof counts]++
      }
    })

    const total = counts.yes + counts.ly + counts.ln + counts.no
    const pctYes = total > 0 ? Math.round(((counts.yes + counts.ly) / total) * 100) : 0
    const pctNo = 100 - pctYes

    const description = total > 0
      ? `${total.toLocaleString()} people have answered. ${pctYes}% yes, ${pctNo}% no. What do you think?`
      : `Be the first to vote on this question at senseUS.`

    const safeText = escapeHtml(question.text)
    const safeDescription = escapeHtml(description)

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${safeText} — senseUS</title>
  <meta name="description" content="${safeDescription}" />

  <!-- Open Graph -->
  <meta property="og:title" content="${safeText}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="https://senseus.app/q/${question.question_number}" />
  <meta property="og:site_name" content="senseUS" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safeText}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:site" content="@senseus" />

  <!-- Redirect real users to the React app -->
  <meta http-equiv="refresh" content="0;url=https://senseus.app/q/${question.question_number}" />
</head>
<body>
  <p>Redirecting to <a href="https://senseus.app/q/${question.question_number}">senseUS</a>...</p>
</body>
</html>`

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "public, max-age=300",
      },
      status: 200,
    })
  } catch (error) {
    return new Response("Error", { status: 500 })
  }
})