/**
 * Backup Router (Panel)
 * REST API proxy for backup operations
 */

import Router from "@koa/router";
import Koa from "koa";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/backup" });

// Shared permission check for instance operations
const checkInstanceAccess = async (
    ctx: Koa.ParameterizedContext,
    daemonId: string,
    instanceUuid: string,
    requiredRole: number = ROLE.USER
) => {
    const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
    if (!remoteService?.available) {
        throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
    }
    return remoteService;
};

// Create a backup for an instance
router.post(
    "/create",
    permission({ level: ROLE.USER }),
    validator({ query: { daemonId: String, instanceUuid: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const instanceUuid = String(ctx.query.instanceUuid);
            const selectedPaths = ctx.request.body?.selectedPaths;

            const remoteService = await checkInstanceAccess(ctx, daemonId, instanceUuid);

            const result = await new RemoteRequest(remoteService).request("backup/create", {
                instanceUuid,
                selectedPaths
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Get backup task status
router.get(
    "/status",
    permission({ level: ROLE.USER }),
    validator({ query: { daemonId: String, taskId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const taskId = String(ctx.query.taskId);

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("backup/status", {
                taskId
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// List backups for an instance
router.get(
    "/list",
    permission({ level: ROLE.USER }),
    validator({ query: { daemonId: String, instanceUuid: String, providerId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const instanceUuid = String(ctx.query.instanceUuid);
            const providerId = String(ctx.query.providerId);

            const remoteService = await checkInstanceAccess(ctx, daemonId, instanceUuid);

            const result = await new RemoteRequest(remoteService).request("backup/list", {
                instanceUuid,
                providerId
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Delete a backup
router.delete(
    "/delete",
    permission({ level: ROLE.USER }),
    validator({ query: { daemonId: String, providerId: String, remotePath: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const providerId = String(ctx.query.providerId);
            const remotePath = String(ctx.query.remotePath);

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("backup/delete", {
                providerId,
                remotePath
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// ==================== Provider Management ====================

// List storage providers
router.get(
    "/providers",
    permission({ level: ROLE.ADMIN }),
    validator({ query: { daemonId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("provider/list", {});

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Add a storage provider
router.post(
    "/providers",
    permission({ level: ROLE.ADMIN }),
    validator({ query: { daemonId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const { name, type, config } = ctx.request.body as any;

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("provider/add", {
                name,
                type,
                config
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Test a provider connection
router.post(
    "/providers/test",
    permission({ level: ROLE.ADMIN }),
    validator({ query: { daemonId: String, providerId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const providerId = String(ctx.query.providerId);

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("provider/test", {
                providerId
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Delete a provider
router.delete(
    "/providers",
    permission({ level: ROLE.ADMIN }),
    validator({ query: { daemonId: String, providerId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const providerId = String(ctx.query.providerId);

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("provider/delete", {
                providerId
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

// Update a provider
router.put(
    "/providers",
    permission({ level: ROLE.ADMIN }),
    validator({ query: { daemonId: String, providerId: String } }),
    async (ctx) => {
        try {
            const daemonId = String(ctx.query.daemonId);
            const providerId = String(ctx.query.providerId);
            const { name, config } = ctx.request.body as any;

            const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
            if (!remoteService?.available) {
                throw new Error($t("TXT_CODE_router.daemonNotAvailable"));
            }

            const result = await new RemoteRequest(remoteService).request("provider/update", {
                providerId,
                name,
                config
            });

            ctx.body = result;
        } catch (error: any) {
            ctx.body = { error: error.message };
            ctx.status = 500;
        }
    }
);

export default router;
