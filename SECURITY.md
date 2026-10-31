# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through
[GitHub's vulnerability reporting](https://github.com/JohnGiag/multitenant-api-template/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it.
A short proof of concept helps.

This is a personal project, provided as is. There's no guarantee of a reply or a fix, so
if you rely on this code, review it yourself and treat any security fixes as your
responsibility.

## Supported versions

There are no releases, and no version is supported.

## In scope

This template's own code, especially anything that breaks:

- Tenant isolation, such as one tenant reading or changing another's data
- Authentication, sessions, API keys or role checks
- Encryption or masking of tenant secrets (BYOK)
- Webhook address checks (SSRF) or signature verification
- The rule that secrets and personal data stay out of logs and telemetry

## Out of scope

- Projects or deployments built from this template: report those to their owners
- Vulnerabilities in dependencies with no practical way to exploit them here
- The local development setup, including `docker-compose.yml`,
  `docker-compose.observability.yml` and their default passwords
- Missing rate limits on routes that are already limited as designed
- Social engineering or denial-of-service attacks

## Safe testing

Please test only against your own local copy, and never against someone else's
deployment or data.
