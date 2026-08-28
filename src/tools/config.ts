/** Community configuration and hardware reads. */
import { z } from "zod";
import { ok } from "../format.js";
import type { ToolDef } from "./types.js";

export const settings: ToolDef = {
  name: "nimbio_settings",
  title: "Community settings",
  description:
    "The community's configuration: the settable options, the terminology it uses for members " +
    "and homes, and a read_only block of feature flags. Those read-only flags are how you " +
    "discover a feature is switched off without calling it and interpreting a permission " +
    "error — they are Nimbio-side provisioning decisions and cannot be set through this API.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "settings",
  endpoints: ["GET /v1/community/settings"],
  async handler(ctx) {
    const s = await ctx.client.community.settings();
    const structured = {
      community_id: s.communityId,
      settings: s.settings,
      read_only: s.readOnly,
      terminology: s.terminology,
      terminology_options: s.terminologyOptions,
    };
    return ok(
      ctx.session,
      `Settings for community ${s.communityId}. The read_only block reports which features are ` +
        `provisioned on; everything under settings is changeable.`,
      structured,
    );
  },
};

export const homes: ToolDef = {
  name: "nimbio_homes",
  title: "List homes",
  description:
    "The units in this community and who lives in each. With home_id, one home in full. " +
    "Residents are attached to a home; removing a home detaches all of them, so read before " +
    "you write.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "homes",
  inputSchema: {
    home_id: z.string().optional().describe("Fetch one home in detail."),
    include_hidden: z.boolean().optional(),
  },
  endpoints: ["GET /v1/community/homes", "GET /v1/community/homes/{}"],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (typeof args.home_id === "string") {
      const h = await c.home(args.home_id);
      const structured = {
        home: {
          home_id: h.homeId,
          name: h.name,
          address: h.address,
          owner_occupied: h.ownerOccupied,
          owner_name: h.ownerName,
          member_count: h.memberCount,
          members: h.members,
        },
      };
      return ok(
        ctx.session,
        `${h.address ?? h.name ?? h.homeId} — ${h.memberCount} resident(s).`,
        structured,
      );
    }
    const list = await c.homes({ includeHidden: Boolean(args.include_hidden) });
    const structured = {
      homes: list.map((h) => ({
        home_id: h.homeId,
        name: h.name,
        address: h.address,
        owner_occupied: h.ownerOccupied,
        hidden: h.hidden,
        member_count: h.memberCount,
      })),
    };
    return ok(
      ctx.session,
      `${list.length} home(s):\n` +
        list
          .slice(0, 50)
          .map((h) => `- [${h.homeId}] ${h.address ?? h.name ?? "(unnamed)"} — ${h.memberCount} resident(s)`)
          .join("\n"),
      structured,
    );
  },
};

export const senseLines: ToolDef = {
  name: "nimbio_sense_lines",
  title: "Sense lines",
  description:
    "The hardware inputs that tell Nimbio whether a gate is physically open. Lists each box, " +
    "its sense lines, whether they are online and reporting, and which latch each is wired to. " +
    "A gate reporting an odd status usually starts here. With sense_line_id and box_id, one " +
    "line in detail; with include_records, the transitions it has observed.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "sense_lines",
  inputSchema: {
    box_id: z.string().optional().describe("Filter to one box, or identify a line for detail."),
    sense_line_id: z.number().int().optional().describe("Fetch one sense line; needs box_id too."),
    include_records: z.boolean().optional().describe("Also fetch observed transitions."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  endpoints: [
    "GET /v1/community/sense-lines",
    "GET /v1/community/sense-lines/{}",
    "GET /v1/community/sense-lines/records",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (typeof args.sense_line_id === "number" && typeof args.box_id === "string") {
      const d = await c.senseLine(args.sense_line_id, args.box_id);
      return ok(ctx.session, `Sense line ${args.sense_line_id} on box ${args.box_id}.`, {
        sense_line: d.raw,
      });
    }
    const lines = await c.senseLines({ boxId: (args.box_id as string) ?? null });
    const records = args.include_records
      ? await c.senseLineRecords({
          boxId: (args.box_id as string) ?? null,
          senseLineId: (args.sense_line_id as number) ?? null,
          limit: args.limit as number | undefined,
        })
      : null;
    const structured = {
      sense_lines: lines.senseLines.map((s) => ({
        box_id: s.boxId,
        box_name: s.boxName,
        sense_line_id: s.senseLineId,
        online: s.senseLineOnline,
        latch_data_online: s.latchDataOnline,
        reporting: s.reporting,
        latches: s.latches,
      })),
      boxes: lines.boxes.map((b) => ({ box_id: b.boxId, box_name: b.boxName })),
      records: records ? records.raw : null,
    };
    const offline = lines.senseLines.filter((s) => !s.senseLineOnline);
    return ok(
      ctx.session,
      [
        `${lines.senseLines.length} sense line(s) across ${lines.boxes.length} box(es).`,
        offline.length
          ? `OFFLINE: ${offline.map((s) => `${s.boxName ?? s.boxId}#${s.senseLineId}`).join(", ")}`
          : "All sense lines online.",
      ].join("\n"),
      structured,
    );
  },
};

export const nfcTags: ToolDef = {
  name: "nimbio_nfc_tags",
  title: "NFC tags",
  description:
    "Physical NFC tags programmed for this community: which gate each opens, whether it is " +
    "disabled, and when it was last scanned. With tag_id, one tag; with include_scan_log, the " +
    "scan history including refused scans.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "nfc_tags",
  inputSchema: {
    tag_id: z.union([z.string(), z.number()]).optional().describe("Fetch one tag in detail."),
    search: z.string().optional(),
    page: z.number().int().min(0).optional(),
    include_scan_log: z.boolean().optional().describe("Also fetch the scan log."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  endpoints: [
    "GET /v1/community/nfc-tags",
    "GET /v1/community/nfc-tags/{}",
    "GET /v1/community/nfc-tags/scan-log",
  ],
  async handler(ctx, args) {
    const c = ctx.client.community;
    if (args.tag_id !== undefined) {
      const t = await c.nfcTag(args.tag_id as string | number);
      return ok(
        ctx.session,
        `Tag ${t.tagId} (${t.tagSerial ?? "no serial"}) -> latch ${t.latchId ?? "unassigned"}` +
          `${t.disabled ? " DISABLED" : ""}.`,
        { tag: t.raw },
      );
    }
    const page = await c.nfcTags({
      search: (args.search as string) ?? null,
      page: args.page as number | undefined,
    });
    const scanLog = args.include_scan_log
      ? await c.nfcScanLog({ limit: args.limit as number | undefined })
      : null;
    const structured = {
      total: page.total,
      page: page.page,
      tags: page.items.map((t) => ({
        tag_id: t.tagId,
        serial: t.tagSerial,
        latch_id: t.latchId,
        disabled: t.disabled,
        last_scan_at: t.lastScanAt,
        notes: t.notes,
      })),
      scan_log: scanLog ? scanLog.raw : null,
    };
    return ok(
      ctx.session,
      `${page.items.length} of ${page.total ?? "?"} tag(s):\n` +
        page.items
          .slice(0, 50)
          .map(
            (t) =>
              `- [${t.tagId}] ${t.tagSerial ?? "?"} -> ${t.latchId ?? "unassigned"}` +
              `${t.disabled ? " DISABLED" : ""}`,
          )
          .join("\n"),
      structured,
    );
  },
};
