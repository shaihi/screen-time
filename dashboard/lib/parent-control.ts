import { z, ZodError } from "zod";
import { getHouseholdById, type Household } from "./households.ts";
import { sessionCookieName, verifySessionToken } from "./session.ts";
import {
  controlCookieName,
  validateControlConfiguration,
  verifyStepUpToken,
} from "./control.ts";
import {
  controlSchemaReady,
  isControlParentSessionActive,
} from "./control-store.ts";

export class ControlHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function controlJson(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      ...headers,
    },
  });
}
export async function controlRoute(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ControlHttpError)
      return controlJson({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return controlJson(
        { error: "Invalid request", details: z.flattenError(error) },
        400,
      );
    const message = error instanceof Error ? error.message : "";
    if (
      /CONTROL_(REVISION_CONFLICT|IDEMPOTENCY_CONFLICT|ALREADY_ENROLLED)/.test(
        message,
      )
    )
      return controlJson(
        {
          error: "The device or revision changed. Refresh before trying again.",
        },
        409,
      );
    if (/CONTROL_DEVICE_NOT_FOUND/.test(message))
      return controlJson({ error: "Enrolled device not found" }, 404);
    if (/CONTROL_(ENROLLMENT_INVALID|UNAUTHORIZED|REPLAY)/.test(message))
      return controlJson({ error: "Unauthorized or replayed request" }, 401);
    if (/CONTROL_INVALID_EFFECTIVE/.test(message))
      return controlJson(
        { error: "Choose activation now or within the next 15 minutes" },
        400,
      );
    if (/CONTROL_FUTURE_REVISION/.test(message))
      return controlJson({ error: "Invalid applied policy revision" }, 400);
    return controlJson(
      {
        error:
          "Control service is not ready. Check its configuration and explicit migration.",
      },
      503,
    );
  }
}
export function requestCookie(request: Request, name: string) {
  const found = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!found) return undefined;
  try {
    return decodeURIComponent(found.slice(name.length + 1));
  } catch {
    return undefined;
  }
}
export async function authenticateControlParent(
  request: Request,
  dependencies: {
    getHousehold: (id: string) => Household | null;
    sessionActive: (householdId: string, session: string) => Promise<boolean>;
    ready: () => Promise<boolean>;
  } = {
    getHousehold: getHouseholdById,
    sessionActive: isControlParentSessionActive,
    ready: controlSchemaReady,
  },
) {
  const token = requestCookie(request, sessionCookieName);
  let householdId: string | null = null;
  try {
    householdId = await verifySessionToken(
      token,
      (id) => dependencies.getHousehold(id)?.password ?? null,
    );
  } catch {}
  if (!householdId || !token)
    throw new ControlHttpError(401, "Parent login required");
  const household = dependencies.getHousehold(householdId);
  if (!household) throw new ControlHttpError(401, "Parent login required");
  if (process.env.CONTROL_PARENT_TOTP_SECRET) {
    if (!(await dependencies.ready()))
      throw new ControlHttpError(
        503,
        "Run the explicit control database migration first",
      );
    if (!(await dependencies.sessionActive(household.id, token)))
      throw new ControlHttpError(401, "Sign in again to use parent controls");
  }
  return { household, session: token };
}
export function controlRequestProtocol(request: Request) {
  // Vercel supplies this header at its trusted TLS termination boundary.
  // A direct client outside that deployment cannot claim HTTPS with a header.
  if (process.env.VERCEL) {
    const forwarded = request.headers.get("x-forwarded-proto");
    if (forwarded === "https" || forwarded === "http") return `${forwarded}:`;
  }
  return new URL(request.url).protocol;
}
export function controlRequestOrigin(request: Request): string | null {
  try {
    const configured = process.env.CONTROL_PUBLIC_ORIGIN;
    if (configured) {
      const url = new URL(configured);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        return null;
      return url.origin;
    }
    // Next can normalize request.url to localhost behind its standalone server.
    // Browser JavaScript cannot forge Host, so it identifies the external origin.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (!host || /[\s,/\\?#@%]/.test(host)) return null;
    const protocol = controlRequestProtocol(request);
    if (protocol !== "https:" && protocol !== "http:") return null;
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}
export function requireSameOrigin(request: Request) {
  const expected = controlRequestOrigin(request);
  if (!expected || request.headers.get("origin") !== expected)
    throw new ControlHttpError(403, "Same-origin request required");
}
export function requireControlHttps(request: Request) {
  if (controlRequestProtocol(request) !== "https:")
    throw new ControlHttpError(
      400,
      "HTTPS is required for device enrollment and sync",
    );
}
export async function requireControlReady() {
  try {
    validateControlConfiguration();
  } catch {
    throw new ControlHttpError(503, "Control configuration is incomplete");
  }
  if (!(await controlSchemaReady()))
    throw new ControlHttpError(
      503,
      "Run the explicit control database migration first",
    );
}
export async function requireControlWrite(request: Request) {
  requireSameOrigin(request);
  const parent = await authenticateControlParent(request);
  await requireControlReady();
  if (
    !verifyStepUpToken(
      requestCookie(request, controlCookieName),
      parent.household.id,
      parent.session,
      process.env.CONTROL_ENCRYPTION_KEY!,
    )
  )
    throw new ControlHttpError(
      403,
      "Unlock parent controls with your authenticator code first",
    );
  return parent;
}
export async function controlRequestText(request: Request, maxBytes = 16384) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ControlHttpError(413, "Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    // Hashing a decoded body must preserve every original UTF-8 byte.
    // Replacement characters would otherwise change the signed body.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new ControlHttpError(400, "Body must be valid UTF-8");
  }
}
export async function controlRequestJson(request: Request) {
  try {
    return JSON.parse(await controlRequestText(request));
  } catch (error) {
    if (error instanceof ControlHttpError) throw error;
    throw new ControlHttpError(400, "Invalid JSON request");
  }
}
