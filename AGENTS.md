# AGENTS.md (shared-schema)

This file defines team-shared conventions for the `shared-schema` repository.
Keep personal workflow preferences in user-level config.

## Project Snapshot

- Canonical scope: `migrations/`, `supabase/functions/`, `scripts/`
- Deployment workflows: `.github/workflows/apply-shared-staging.yml`, `.github/workflows/promote-shared-prod.yml`
- Runtime targets: `shared-staging`, `shared-prod`

## Working Agreements

- Keep all policy and process descriptions in English.
- Keep changes small, reviewable, and scoped to a single intent.
- Do not mix unrelated changes in one PR.
- Avoid overly verbose descriptions or unnecessary details.

## Issue and PR Conventions

- Create an issue before implementation for non-trivial work.
- Use issue types: `Bug`, `Feature`, `Task`.
- Include background, acceptance criteria, scope, and links in issue body.
- Link PRs to issues with `Closes #<issue-number>`.

## Commit Message Policy (Required)

- Use Conventional Commits format: `<type>(<scope>): <subject>`.
- Allowed `type`: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
- Disallowed `type`: `ci`, `perf`, `revert`.
- Keep `subject` concise and do not end with a period.
- If commit body is present, write it in Korean bullet format only.
- Commit body bullet count must be between 1 and 4.
- Footer should include `Refs: #<issue-number>` or `Closes: #<issue-number>` when applicable.

## Verification

- Confirm AGENTS language is English-only.
- Confirm commit policy text includes allowed/disallowed types and body constraints.
- Confirm no runtime DB/function behavior is changed by documentation-only updates.
