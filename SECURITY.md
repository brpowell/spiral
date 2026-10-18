# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately in one of these ways:

1. **GitHub private vulnerability reporting (preferred):** open the repository's **Security** tab, choose **Report a vulnerability**, and fill in the form.
2. **Email:** [hello@spiralpowered.com](mailto:hello@spiralpowered.com) with `Security` in the subject line.

Please include, as far as you can:

- what is affected (the desktop app, the registry service, or the item format library) and the version or commit;
- how to reproduce the problem, ideally with a minimal example such as a crafted `.spk` or request;
- what you believe the impact is.

## What to expect

We will acknowledge your report as soon as we can, look into it, and keep you updated on progress. Once a fix is available we are happy to credit you if you would like, and we ask that you give us a reasonable amount of time to ship a fix before disclosing details publicly.

This is a small open source project, so response times are best effort rather than guaranteed.

## Supported versions

Security fixes are made on `main` and released as a new version of the desktop app. Only the latest desktop release and the current `main` branch are supported.

## Scope

In scope:

- the desktop app (`apps/desktop`), including how it opens, installs and runs items;
- the registry service (`apps/registry`), including upload handling, authentication, storage and what it serves;
- the item format library (`libs/spk-format`), including archive extraction and manifest validation.

Examples of reports we want: path traversal or arbitrary file writes from a crafted item, resource exhaustion from a small archive, authentication bypass on the registry admin endpoints, and content served from the registry that can execute in a browser.

Generally not in scope:

- macOS and Windows builds being unsigned or not notarized. This is known and being worked on.
- Weaknesses that only exist in a self-hosted registry because of its configuration, such as a short or reused `ADMIN_TOKEN`. The registry requires a token of at least 32 bytes when admin endpoints are enabled.
- Findings in third-party dependencies with no demonstrable impact on Spiral. Reports that show how a vulnerable dependency is reachable are welcome.
