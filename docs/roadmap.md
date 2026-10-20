# Roadmap

- [ ] Phase 0: Repository, schema, conventions (this commit)
- [x] Phase 1: Prompt-only pipeline with Gemini (spec -> code -> validate -> repair)
- [ ] Phase 2: Eval set (200-500 requests) and baseline metrics
- [ ] Phase 3: Retrieval of templates and examples
- [ ] Phase 4: Gold dataset (50-100 Firebase + Apps Script examples), synthetic expansion
- [x] Phase 5: Model Evaluation, Inference, and System Integration (implementation complete; production verification pending)
- [ ] Phase 6: Router (small model for simple edits, Gemini for planning)
- [ ] Phase 7: Guardrails, sandboxing, quotas, cost controls, deploy

## Verification Notes

- Phase 5 implementation baseline:
  - Deployed target URL: `https://vercel.app` (configured target; live deployment not independently verified)
  - Persistent table: `public.chat_messages` (defined in `supabase/schema.sql`; remote creation and persistence not verified)
  - Network communication: direct client-side inserts using the Supabase publishable key and the `anon` role, subject to the local insert-only RLS policy
- Post-deployment verification: pending remote deployment and database checks. The workspace has no Supabase project link, CLI, or configured access token to verify the remote table or live insert path.
- Workspace directory audit: failed. The root contains more than five directories and legacy Firebase artifacts remain, including `.firebase/`, `web/firebase.json`, and `functions/generated/` Firebase code. No legacy files were removed as part of this audit.
