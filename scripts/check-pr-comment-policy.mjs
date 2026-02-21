#!/usr/bin/env node
import fs from "node:fs";

function fail(message) {
  console.error(`[pr-comment-policy] FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {
    commentsFile: "",
    prAuthor: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--comments-file") {
      result.commentsFile = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--comments-file=")) {
      result.commentsFile = arg.slice("--comments-file=".length);
      continue;
    }
    if (arg === "--pr-author") {
      result.prAuthor = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--pr-author=")) {
      result.prAuthor = arg.slice("--pr-author=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/check-pr-comment-policy.mjs [--comments-file <json>] [--pr-author <login>]",
      );
      process.exit(0);
    }
  }

  return result;
}

function isPullRequestEvent(payload) {
  return Boolean(
    payload.pull_request || (payload.issue && payload.issue.pull_request),
  );
}

function extractRepo(payload) {
  const fullName = payload.repository?.full_name || process.env.GITHUB_REPOSITORY;
  if (!fullName || !fullName.includes("/")) {
    fail("Repository context missing.");
  }
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}

function extractPrNumber(payload) {
  if (payload.pull_request?.number) {
    return payload.pull_request.number;
  }
  if (payload.issue?.number && payload.issue?.pull_request) {
    return payload.issue.number;
  }
  fail("PR number missing in event payload.");
}

async function githubGet(path, token) {
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ohmytoken-pr-comment-policy",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    fail(`GitHub API ${response.status} on ${path}: ${text}`);
  }

  return response.json();
}

async function fetchPrAndComments({ owner, repo, prNumber, token }) {
  const pr = await githubGet(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);
  const comments = [];

  for (let page = 1; page <= 10; page += 1) {
    const chunk = await githubGet(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }
    comments.push(...chunk);
    if (chunk.length < 100) {
      break;
    }
  }

  return { pr, comments };
}

function isHangul(text) {
  return /[\uAC00-\uD7A3\u3131-\u318E\u314F-\u3163]/.test(text);
}

function hasTag(text) {
  return /^\s*\[(progress|plan-change|blocked|ready)\]\b/i.test(text);
}

function hasActionableContent(text) {
  const stripped = text
    .replace(/^\s*\[(progress|plan-change|blocked|ready)\]\s*/i, "")
    .trim();
  if (stripped.length < 20) {
    return false;
  }
  return /[A-Za-z]/.test(stripped);
}

function mainPolicy({ prAuthor, comments }) {
  const authorComments = comments.filter(
    (comment) => comment?.user?.login === prAuthor,
  );

  if (authorComments.length === 0) {
    fail(
      `No PR issue comments found from PR author (${prAuthor}). Add at least one tagged progress comment.`,
    );
  }

  const validComments = authorComments.filter((comment) => {
    const body = String(comment?.body || "");
    if (!hasTag(body)) return false;
    if (!hasActionableContent(body)) return false;
    if (isHangul(body)) return false;
    return true;
  });

  if (validComments.length === 0) {
    fail(
      [
        `PR author comments found (${authorComments.length}) but none match policy.`,
        "Comment must:",
        "1) start with one of [progress], [plan-change], [blocked], [ready]",
        "2) be English and action-oriented (>= 20 chars after tag)",
        "3) not include Hangul",
      ].join("\n"),
    );
  }

  console.log(
    `[pr-comment-policy] PASS: author=${prAuthor}, valid_comments=${validComments.length}, total_author_comments=${authorComments.length}`,
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.commentsFile) {
    if (!args.prAuthor) {
      fail("`--pr-author` is required when using `--comments-file`.");
    }
    if (!fs.existsSync(args.commentsFile)) {
      fail(`Comments file not found: ${args.commentsFile}`);
    }
    const comments = JSON.parse(fs.readFileSync(args.commentsFile, "utf8"));
    if (!Array.isArray(comments)) {
      fail("Comments file must be a JSON array.");
    }
    mainPolicy({ prAuthor: args.prAuthor, comments });
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.log("[pr-comment-policy] INFO: GITHUB_EVENT_PATH not found, skipping.");
    process.exit(0);
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!isPullRequestEvent(payload)) {
    console.log("[pr-comment-policy] INFO: not a PR event, skipping.");
    process.exit(0);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    fail("GITHUB_TOKEN is required.");
  }

  const { owner, repo } = extractRepo(payload);
  const prNumber = extractPrNumber(payload);
  const { pr, comments } = await fetchPrAndComments({
    owner,
    repo,
    prNumber,
    token,
  });

  const prAuthor = pr?.user?.login;
  if (!prAuthor) {
    fail("PR author login missing.");
  }

  mainPolicy({ prAuthor, comments });
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
