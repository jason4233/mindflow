# MindFlow Desktop CI/CD Verification

Verified on 2026-07-25.

## Workflow

- File: `.github/workflows/release.yml`
- Triggers: pushes to `main`, `v*` tag pushes, and manual `workflow_dispatch`
- Runner: `windows-latest`
- Build: `npm ci` and `npm run build` from `desktop/`
- Rolling release: tag `latest`, title `MindFlow Latest Build`
- Rolling asset: `MindFlow-portable.exe`
- Version releases: created for `v*` tag pushes

## Successful GitHub Actions run

- Commit: `6f7e94f36d81557fe3b3a352c453cb8ef6d9b53a`
- Run: https://github.com/jason4233/mindflow/actions/runs/30152340230
- Result: `completed / success`
- Completed steps:
  - Install desktop dependencies
  - Build portable executable
  - Prepare fixed release filename
  - Publish GitHub releases

## Release verification evidence

`gh release view latest` and the GitHub latest-release API returned:

- Tag: `latest`
- Title: `MindFlow Latest Build`
- Target commit: `6f7e94f36d81557fe3b3a352c453cb8ef6d9b53a`
- Published at: `2026-07-25T09:12:00Z`
- Asset: `MindFlow-portable.exe`
- Asset state: `uploaded`
- Asset size: `90,070,898` bytes
- Asset digest: `sha256:096d22f5734ad4133991a0d1da096d0ad3ace8786ca4d90e85ff898a489ec75b`

The permanent download URL returned HTTP `200` with a matching
`Content-Length: 90070898`:

https://github.com/jason4233/mindflow/releases/latest/download/MindFlow-portable.exe
