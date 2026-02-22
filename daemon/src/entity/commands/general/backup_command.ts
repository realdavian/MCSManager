/**
 * Backup Command
 * Preset command for triggering manual backups
 */

import { $t } from "../../../i18n";
import { TaskCenter } from "../../../service/async_task_service";
import BackupAsyncTask from "../../../service/async_task_service/backup_task";
import Instance from "../../instance/instance";
import InstanceCommand from "../base/command";

export interface IBackupCommandParams {
    selectedPaths?: string[];
}

export default class BackupCommand extends InstanceCommand {
    constructor() {
        super("BackupCommand");
    }

    async exec(instance: Instance, params?: IBackupCommandParams): Promise<BackupAsyncTask> {
        // Check if instance is stopped (recommended for consistent backups)
        if (instance.status() !== Instance.STATUS_STOP) {
            instance.println(
                "WARN",
                $t("TXT_CODE_backup_instanceRunningWarning") ||
                "Warning: Instance is running. Backup may be inconsistent."
            );
        }

        // Check if backup is enabled
        if (!instance.config.backupConfig?.enabled) {
            throw new Error(
                $t("TXT_CODE_backup_notEnabled") || "Backup is not enabled for this instance"
            );
        }

        // Check if another backup is in progress
        if (instance.asynchronousTask) {
            throw new Error(
                $t("TXT_CODE_backup_taskInProgress") || "Another task is already in progress"
            );
        }

        // Create and start backup task
        const task = new BackupAsyncTask(instance, "manual", params?.selectedPaths);

        // Set as instance's current async task
        instance.asynchronousTask = task;

        // Register with TaskCenter
        TaskCenter.addTask(task);

        // Listen for completion/error
        task.on("stopped", () => {
            if (instance.asynchronousTask === task) {
                instance.asynchronousTask = null;
            }
            const result = task.getResult();
            if (result?.success) {
                instance.println(
                    "INFO",
                    $t("TXT_CODE_backup_success") || "Backup completed successfully"
                );
            }
        });

        task.on("error", (err) => {
            if (instance.asynchronousTask === task) {
                instance.asynchronousTask = null;
            }
            instance.println(
                "ERROR",
                ($t("TXT_CODE_backup_failed") || "Backup failed") + `: ${err.message}`
            );
        });

        // Log progress
        task.on("progress", (progress) => {
            if (progress.phase === "compressing" && progress.percent === 0) {
                instance.println("INFO", $t("TXT_CODE_backup_compressing") || "Compressing files...");
            } else if (progress.phase === "uploading" && progress.percent === 0) {
                instance.println("INFO", $t("TXT_CODE_backup_uploading") || "Uploading to remote storage...");
            }
        });

        instance.println("INFO", $t("TXT_CODE_backup_started") || "Backup started...");

        return task;
    }

    async stop(instance: Instance): Promise<void> {
        if (instance.asynchronousTask instanceof BackupAsyncTask) {
            await instance.asynchronousTask.stop();
            instance.asynchronousTask = null;
        }
    }
}
