import fs from "node:fs";
import nodeCron from "node-cron";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";

/**
 * Where the server's memory goes (31 Oct 2026). Railway bills memory, and the
 * server sits near 1 GB minutes after a restart while live JavaScript is only
 * ~65 MB - so most of it is outside JavaScript. Two things answer "what":
 *  - /health shows the system's own split: program memory (RssAnon: data the
 *    server allocated) vs library files mapped in (RssFile), plus the peak.
 *  - one log line, "memory jump", whenever a single request or background job
 *    leaves the server 50 MB+ bigger than when it started, naming it.
 * Read-only: nothing here changes what the server does.
 */
const MB = 1024 * 1024;
export const MEMORY_JUMP_MB = 50;

/** The system's view of this process (Linux only; null elsewhere). */
export function processMemory(): Record<string, number> | null {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const field = (name: string) => {
      const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, "m").exec(status);
      return match ? Math.round(Number(match[1]) / 1024) : null;
    };
    const threads = /^Threads:\s+(\d+)/m.exec(status);
    return {
      programMb: field("RssAnon") ?? -1,
      libraryFilesMb: field("RssFile") ?? -1,
      sharedMb: field("RssShmem") ?? -1,
      peakMb: field("VmHWM") ?? -1,
      threads: threads ? Number(threads[1]) : -1
    };
  } catch {
    return null;
  }
}

const reportJump = (label: string, rssBefore: number, startedAt: number, extra?: Record<string, unknown>) => {
  const rssAfter = process.memoryUsage.rss();
  const grewMb = Math.round((rssAfter - rssBefore) / MB);
  if (grewMb < MEMORY_JUMP_MB) return;
  const usage = process.memoryUsage();
  logger.warn("memory jump", {
    label,
    grewMb,
    rssMb: Math.round(rssAfter / MB),
    heapUsedMb: Math.round(usage.heapUsed / MB),
    arrayBuffersMb: Math.round(usage.arrayBuffers / MB),
    ms: Date.now() - startedAt,
    ...extra
  });
};

/** Runs fn and logs a "memory jump" if the server grew 50 MB+ while it ran. */
export async function watchMemory<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  const rssBefore = process.memoryUsage.rss();
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    reportJump(label, rssBefore, startedAt);
  }
}

// A job's name, read from the first function it awaits ("runCartAutoSubmit").
const jobName = (fn: (...args: any[]) => unknown) => {
  const source = fn.toString();
  return /await\s+([A-Za-z_$][\w$]*)\s*\(/.exec(source)?.[1]
    ?? /\b(run[A-Z]\w*|sync[A-Z]\w*|check[A-Z]\w*)\s*\(/.exec(source)?.[1]
    ?? "job";
};

/** node-cron, with every scheduled job watched by watchMemory. */
export const cron = {
  ...nodeCron,
  schedule: ((expression: string, fn: (...args: any[]) => unknown, options?: any) =>
    nodeCron.schedule(expression, (...args: any[]) => watchMemory(`job ${jobName(fn)} (${expression})`, () => fn(...args)), options)
  ) as typeof nodeCron.schedule
};

let requestsInFlight = 0;
// "/api/orders/abc-123?x=1" -> "/api/orders/:id" so the same route groups together.
const routeOf = (req: Request) => req.originalUrl.split("?")[0]
  .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
  .replace(/\/\d+(?=\/|$)/g, "/:n");

/** Express middleware: logs a "memory jump" for any request that left the server 50 MB+ bigger. */
export function watchRequestMemory(req: Request, res: Response, next: NextFunction) {
  const rssBefore = process.memoryUsage.rss();
  const startedAt = Date.now();
  requestsInFlight += 1;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    requestsInFlight -= 1;
    reportJump(`request ${req.method} ${routeOf(req)}`, rssBefore, startedAt, {
      status: res.statusCode,
      // Other requests running at the same time share the blame.
      alsoRunning: requestsInFlight
    });
  };
  res.on("finish", finish);
  res.on("close", finish);
  next();
}
