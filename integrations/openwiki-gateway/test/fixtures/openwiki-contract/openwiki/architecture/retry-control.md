---
title: Retry Control
description: How the worker bounds and schedules retries of failed repository operations.
tags:
  - reliability
  - retry
sources:
  - resource: repo://src/worker/retry.ts
---
# Retry Control

The retry controller bounds how many times a failed repository operation runs
before it gives up and reports an error.

## Backoff Schedule

Retries use exponential backoff with jitter, capped at thirty seconds. Each
failed attempt doubles the delay before the next try.

## Cancellation

A cancellation signal aborts the pending retry timer and clears the queued
attempts without running them.
