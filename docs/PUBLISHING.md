# Publishing this repo

A one-time checklist for whoever (currently: the maintainer with push access to
[`Open-Tech-Africa/ota-captive-portal`](https://github.com/Open-Tech-Africa/ota-captive-portal)) takes this from a
private repo to a public one. This doc is for that person, not for someone who's already cloned a public repo — if
that's you, see the [README](../README.md) instead.

## 1. Confirm no secrets are anywhere in git history

Making a repo public exposes its **entire history**, not just the current files — deleting a secret in a later
commit does not remove it from an earlier one. Before flipping visibility, run both of these from a clean clone (not
just the working copy, in case anything was reverted rather than git-ignored from the start):

```bash
# .env must never have been committed, ever, on any branch
git log --all --oneline -- .env
# (no output = clean)

# scan every commit's diff for common live-credential shapes
git log --all -p | grep -nE "sk_live_|rk_live_|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----"
# (no output = clean)
```

If either command finds something, don't just delete it in a new commit — see GitHub's
[guide on removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
(history rewrite + rotate the exposed credential, since it must be treated as compromised).

Also sanity-check `.gitignore` actually covers what you think it does — this repo's current list: `.env*`,
`/.cloudflared` (tunnel credentials), `/src/generated` (generated Prisma clients, regenerated from schema on every
install), plus the usual `node_modules`/`.next`/build output.

## 2. Add a LICENSE

There isn't one yet — add one before going public, not after (code with no license is technically "all rights
reserved" by default, which defeats the point of a public template). Common choices for this kind of project:

- **MIT** — permissive, minimal conditions, most common choice for a reference/template repo like this one.
- **Apache-2.0** — permissive plus an explicit patent grant; a reasonable alternative if that matters to you.

Pick one and add `LICENSE` at the repo root — GitHub's "Add file" UI can generate either from a template, or use
`gh repo license-template <mit|apache-2.0>` / copy the text from [choosealicense.com](https://choosealicense.com/).
