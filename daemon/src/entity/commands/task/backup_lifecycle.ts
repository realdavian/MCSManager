/**
 * Backup Lifecycle Task
 * Handles scheduled backups and on-stop backups
 */

import { $t } from "../../../i18n";
import backupService from "../../../service/backup/backup_service";
import logger from "../../../service/log";
import Instance from "../../instance/instance";
import { ILifeCycleTask } from "../../instance/life_cycle";

export default class BackupLifeCycleTask implements ILifeCycleTask {
    public status: number = 0;
    public name: string = "BackupLifeCycleTask";

    private scheduledBackupTimer: NodeJS.Timeout | null = null;
    private instance: Instance | null = null;

    async start(instance: Instance): Promise<void> {
        this.instance = instance;
        const backupConfig = instance.config.backupConfig;

        if (!backupConfig?.enabled) return;

        // Start scheduled backup timer if enabled
        if (backupConfig.scheduledBackup && backupConfig.scheduleInterval > 0) {
            const intervalMs = backupConfig.scheduleInterval * 60 * 1000; // Convert minutes to ms

            this.scheduledBackupTimer = setInterval(async () => {
                await this.triggerScheduledBackup(instance);
            }, intervalMs);

            logger.info(
                `BackupLifeCycleTask [${instance.config.nickname}]: Scheduled backup every ${backupConfig.scheduleInterval} minutes`
            );
        }
    }

    async stop(instance: Instance): Promise<void> {
        const backupConfig = instance.config.backupConfig;

        // Clear scheduled timer
        if (this.scheduledBackupTimer) {
            clearInterval(this.scheduledBackupTimer);
            this.scheduledBackupTimer = null;
        }

        // Trigger on-stop backup if enabled
        if (backupConfig?.enabled && backupConfig?.onStopBackup) {
            await this.triggerOnStopBackup(instance);
        }

        this.instance = null;
    }

    /**
     * Trigger a scheduled backup
     */
    private async triggerScheduledBackup(instance: Instance): Promise<void> {
        logger.info(`BackupLifeCycleTask [${instance.config.nickname}]: Triggering scheduled backup`);

        try {
            // Only backup if instance is running
            if (instance.status() !== Instance.STATUS_RUNNING) {
                logger.info(
                    `BackupLifeCycleTask [${instance.config.nickname}]: Skipping scheduled backup - instance not running`
                );
                return;
            }

            // Don't interrupt if another task is running
            if (instance.asynchronousTask) {
                logger.info(
                    `BackupLifeCycleTask [${instance.config.nickname}]: Skipping scheduled backup - another task in progress`
                );
                return;
            }

            const result = await backupService.createBackup(instance, "scheduled");

            if (result.success) {
                instance.println(
                    "INFO",
                    $t("TXT_CODE_backup_scheduledSuccess") || "Scheduled backup completed successfully"
                );
                logger.info(
                    `BackupLifeCycleTask [${instance.config.nickname}]: Scheduled backup completed`
                );
            } else {
                instance.println(
                    "WARN",
                    ($t("TXT_CODE_backup_scheduledFailed") || "Scheduled backup failed") +
                    `: ${result.error}`
                );
                logger.warn(
                    `BackupLifeCycleTask [${instance.config.nickname}]: Scheduled backup failed: ${result.error}`
                );
            }
        } catch (error: any) {
            logger.error(
                `BackupLifeCycleTask [${instance.config.nickname}]: Scheduled backup error`,
                error
            );
        }
    }

    /**
     * Trigger on-stop backup
     */
    private async triggerOnStopBackup(instance: Instance): Promise<void> {
        logger.info(`BackupLifeCycleTask [${instance.config.nickname}]: Triggering on-stop backup`);

        try {
            instance.println(
                "INFO",
                $t("TXT_CODE_backup_onStopStarting") || "Starting on-stop backup..."
            );

            const result = await backupService.createBackup(instance, "on_stop");

            if (result.success) {
                instance.println(
                    "INFO",
                    $t("TXT_CODE_backup_onStopSuccess") || "On-stop backup completed successfully"
                );
                logger.info(
                    `BackupLifeCycleTask [${instance.config.nickname}]: On-stop backup completed`
                );
            } else {
                instance.println(
                    "WARN",
                    ($t("TXT_CODE_backup_onStopFailed") || "On-stop backup failed") + `: ${result.error}`
                );
                logger.warn(
                    `BackupLifeCycleTask [${instance.config.nickname}]: On-stop backup failed: ${result.error}`
                );
            }
        } catch (error: any) {
            instance.println(
                "ERROR",
                ($t("TXT_CODE_backup_onStopError") || "On-stop backup error") + `: ${error.message}`
            );
            logger.error(
                `BackupLifeCycleTask [${instance.config.nickname}]: On-stop backup error`,
                error
            );
        }
    }
}
