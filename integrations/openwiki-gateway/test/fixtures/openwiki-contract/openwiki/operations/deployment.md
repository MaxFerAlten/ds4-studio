---
title: Deployment
description: Release promotion and rollback procedure for the studio service.
tags:
  - operations
sources:
  - resource: repo://scripts/deploy.sh
---
# Deployment

Deployment promotes one pinned release and keeps the previous release available
for rollback.

## Rollback

Rollback repoints the current symlink to the previous pinned release and
restarts the service; no recompilation is required.
