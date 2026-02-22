/**
 * Backup Router
 * WebSocket router for backup operations
 */

import { $t } from "../i18n";
import { TaskCenter } from "../service/async_task_service";
import BackupAsyncTask from "../service/async_task_service/backup_task";
import backupService from "../service/backup/backup_service";
import logger from "../service/log";
import { response, responseError } from "../service/protocol";
import { routerApp } from "../service/router";
import InstanceSubsystem from "../service/system_instance";

// Initialize backup service providers on router load
backupService.initProviders();

// Create a backup for an instance
routerApp.on("backup/create", async (ctx, data) => {
    try {
        const instanceUuid = data.instanceUuid;
        const selectedPaths = data.selectedPaths;

        const instance = InstanceSubsystem.getInstance(instanceUuid);
        if (!instance) {
            throw new Error($t("TXT_CODE_backup_instanceNotFound") || "Instance not found");
        }

        if (!instance.config.backupConfig?.enabled) {
            throw new Error($t("TXT_CODE_backup_notEnabled") || "Backup is not enabled for this instance");
        }

        if (instance.asynchronousTask) {
            throw new Error($t("TXT_CODE_backup_taskInProgress") || "Another task is already in progress");
        }

        // Create backup task
        const task = new BackupAsyncTask(instance, "manual", selectedPaths);
        instance.asynchronousTask = task;
        TaskCenter.addTask(task);

        // Clean up on completion
        task.on("stopped", () => {
            if (instance.asynchronousTask === task) {
                instance.asynchronousTask = null;
            }
        });
        task.on("error", () => {
            if (instance.asynchronousTask === task) {
                instance.asynchronousTask = null;
            }
        });

        response(ctx, {
            taskId: task.taskId,
            instanceUuid
        });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Get backup task status
routerApp.on("backup/status", async (ctx, data) => {
    try {
        const taskId = data.taskId;
        const task = TaskCenter.getTask(taskId, BackupAsyncTask.TYPE);

        if (!task) {
            throw new Error($t("TXT_CODE_backup_taskNotFound") || "Backup task not found");
        }

        response(ctx, task.toObject());
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// List backups for an instance
routerApp.on("backup/list", async (ctx, data) => {
    try {
        const instanceUuid = data.instanceUuid;
        const providerId = data.providerId;

        const instance = InstanceSubsystem.getInstance(instanceUuid);
        if (!instance) {
            throw new Error($t("TXT_CODE_backup_instanceNotFound") || "Instance not found");
        }

        const backups = await backupService.listBackups(instanceUuid, providerId);
        response(ctx, { backups });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Delete a backup
routerApp.on("backup/delete", async (ctx, data) => {
    try {
        const providerId = data.providerId;
        const remotePath = data.remotePath;

        await backupService.deleteBackup(providerId, remotePath);
        response(ctx, { success: true });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

logger.info("BackupRouter: Backup router initialized");
