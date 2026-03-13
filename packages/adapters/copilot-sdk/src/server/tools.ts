import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { z } from "zod";

function makeHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function callPaperclipApi(
  apiUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: makeHeaders(apiKey),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
  }
  return res.json().catch(() => ({}));
}

export function buildPaperclipTools(
  paperclipEnv: Record<string, string>,
  runId: string,
  issueId?: string,
  authToken?: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Tool<any>[] {
  const apiUrl = paperclipEnv.PAPERCLIP_API_URL ?? "";
  const agentId = paperclipEnv.PAPERCLIP_AGENT_ID ?? "";
  const companyId = paperclipEnv.PAPERCLIP_COMPANY_ID ?? "";
  // Prefer the injected authToken (local agent JWT), fall back to env vars
  const apiKey = authToken ?? process.env.PAPERCLIP_API_KEY ?? process.env.PAPERCLIP_AGENT_API_KEY ?? "";

  return [
    defineTool("paperclip_get_run", {
      description: "Fetch details about the current Paperclip run including the task and instructions.",
      parameters: z.object({}),
      handler: async () => {
        if (!apiUrl || !runId) return { error: "PAPERCLIP_API_URL or run ID not set" };
        return callPaperclipApi(apiUrl, apiKey, "GET", `/api/heartbeat-runs/${runId}`);
      },
    }),

    defineTool("paperclip_post_comment", {
      description: "Post a comment on the current Paperclip issue for the board operators to see.",
      parameters: z.object({
        body: z.string().describe("The comment text (markdown supported)"),
      }),
      handler: async ({ body }) => {
        if (!apiUrl) return { error: "PAPERCLIP_API_URL not set" };
        if (!issueId) return { error: "No issue ID available for this run — cannot post comment" };
        return callPaperclipApi(apiUrl, apiKey, "POST", `/api/issues/${issueId}/comments`, { body });
      },
    }),

    defineTool("paperclip_request_approval", {
      description: "Request approval from board operators before proceeding with an action. Posts a visible comment on the issue requesting sign-off.",
      parameters: z.object({
        action: z.string().describe("Description of the action requiring approval"),
        context: z.string().optional().describe("Additional context or reason for the request"),
      }),
      handler: async ({ action, context: ctx }) => {
        if (!apiUrl) return { error: "PAPERCLIP_API_URL not set" };
        if (!issueId) return { error: "No issue ID available for this run — cannot post approval request" };
        const commentBody = `**⏸ Approval Requested**\n\nThe agent is pausing and requesting board approval before proceeding.\n\n**Action:** ${action}${ctx ? `\n\n**Context:** ${ctx}` : ""}`;
        return callPaperclipApi(apiUrl, apiKey, "POST", `/api/issues/${issueId}/comments`, { body: commentBody });
      },
    }),

    defineTool("paperclip_get_issue", {
      description: "Fetch full details of a Paperclip issue including title, description, status, and comments.",
      parameters: z.object({
        issueId: z.string().optional().describe("The UUID of the issue to fetch. Defaults to the current run's issue."),
      }),
      handler: async ({ issueId: reqIssueId }) => {
        if (!apiUrl) return { error: "PAPERCLIP_API_URL not set" };
        const targetId = reqIssueId ?? issueId;
        if (!targetId) return { error: "No issue ID provided and no issue associated with this run" };
        return callPaperclipApi(apiUrl, apiKey, "GET", `/api/issues/${targetId}`);
      },
    }),

    defineTool("paperclip_list_issues", {
      description: "List issues in this agent's company.",
      parameters: z.object({
        limit: z.number().int().min(1).max(100).optional().describe("Max number of issues to return (default 20)"),
        status: z.string().optional().describe("Filter by status (e.g. open, closed)"),
      }),
      handler: async ({ limit, status }) => {
        if (!apiUrl || !companyId) return { error: "PAPERCLIP_API_URL or company ID not set" };
        const qs = new URLSearchParams();
        if (limit) qs.set("limit", String(limit));
        if (status) qs.set("status", status);
        const query = qs.toString() ? `?${qs}` : "";
        return callPaperclipApi(apiUrl, apiKey, "GET", `/api/companies/${companyId}/issues${query}`);
      },
    }),

    defineTool("paperclip_create_issue", {
      description: "Create a new issue in Paperclip for tracking work items.",
      parameters: z.object({
        title: z.string().describe("Issue title"),
        description: z.string().optional().describe("Issue description (markdown supported)"),
        priority: z.string().optional().describe("Priority: low, medium, high, urgent"),
      }),
      handler: async ({ title, description, priority }) => {
        if (!apiUrl || !companyId) return { error: "PAPERCLIP_API_URL or company ID not set" };
        return callPaperclipApi(apiUrl, apiKey, "POST", `/api/companies/${companyId}/issues`, {
          title,
          description,
          priority,
        });
      },
    }),

    defineTool("paperclip_update_issue", {
      description:
        "Update an existing Paperclip issue — e.g. change status to in_progress or done, edit title/description, or add a comment.",
      parameters: z.object({
        issueId: z.string().describe("The UUID of the issue to update"),
        status: z
          .string()
          .optional()
          .describe("New status: backlog, todo, in_progress, in_review, done, cancelled"),
        title: z.string().optional().describe("Updated issue title"),
        description: z.string().optional().describe("Updated description (markdown supported)"),
        priority: z.string().optional().describe("Priority: low, medium, high, urgent"),
        comment: z
          .string()
          .optional()
          .describe("A comment to post on the issue at the same time as the update"),
      }),
      handler: async ({ issueId, status, title, description, priority, comment }) => {
        if (!apiUrl || !issueId) return { error: "PAPERCLIP_API_URL or issueId not set" };
        const body: Record<string, unknown> = {};
        if (status !== undefined) body.status = status;
        if (title !== undefined) body.title = title;
        if (description !== undefined) body.description = description;
        if (priority !== undefined) body.priority = priority;
        if (comment !== undefined) body.comment = comment;
        return callPaperclipApi(apiUrl, apiKey, "PATCH", `/api/issues/${issueId}`, body);
      },
    }),

    defineTool("paperclip_delegate_task", {
      description:
        "Reassign a Paperclip issue to another agent. Use when you need a specialist agent to continue this work.",
      parameters: z.object({
        issueId: z.string().describe("The UUID of the issue to delegate"),
        assigneeAgentId: z.string().describe("The UUID of the agent to assign the issue to"),
        comment: z
          .string()
          .optional()
          .describe("Optional handoff comment explaining why you are delegating"),
      }),
      handler: async ({ issueId, assigneeAgentId, comment }) => {
        if (!apiUrl || !issueId) return { error: "PAPERCLIP_API_URL or issueId not set" };
        const body: Record<string, unknown> = { assigneeAgentId };
        if (comment !== undefined) body.comment = comment;
        return callPaperclipApi(apiUrl, apiKey, "PATCH", `/api/issues/${issueId}`, body);
      },
    }),
  ];
}
