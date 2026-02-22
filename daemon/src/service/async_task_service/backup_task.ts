/**
 * Backup Async Task
 * Long-running task for backup operations with progress tracking
 */

import { v4 as uuidv4 } from "uuid";
import Instance from "../../entity/instance/instance";
import backupService, { BackupTrigger, IBackupProgress, IBackupResult } from "../backup/backup_service";
import logger from "../log";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export interface IBackupTaskParams {
    instanceUuid: string;
    trigger: BackupTrigger;
    selectedPaths?: string[];
}

export default class BackupAsyncTask extends AsyncTask {
    public static readonly TYPE = "BackupAsyncTask";

    private instance: Instance;
    private trigger: BackupTrigger;
    private selectedPaths?: string[];
    private result?: IBackupResult;
    private progress: IBackupProgress = { phase: "compressing", percent: 0 };

    constructor(instance: Instance, trigger: BackupTrigger, selectedPaths?: string[]) {
        super();
        this.taskId = uuidv4();
        this.type = BackupAsyncTask.TYPE;
        this.instance = instance;
        this.trigger = trigger;
        this.selectedPaths = selectedPaths;
    }

    async onStart(): Promise<void> {
        logger.info(
            `BackupAsyncTask [${this.taskId}]: Starting backup for [${this.instance.config.nickname}]`
        );

        this.result = await backupService.createBackup(
            this.instance,
            this.trigger,
            this.selectedPaths,
            (progress) => {
                this.progress = progress;
                this.emit("progress", progress);
            }
        );

        if (!this.result.success) {
            throw new Error(this.result.error || "Backup failed");
        }

        logger.info(
            `BackupAsyncTask [${this.taskId}]: Backup complete for [${this.instance.config.nickname}]`
        );
    }

    async onStop(): Promise<void> {
        logger.info(`BackupAsyncTask [${this.taskId}]: Stopping backup task`);
        // Note: We can't really stop a compression or upload in progress
        // This is mainly for cleanup
    }

    async onError(err: Error): Promise<void> {
        logger.error(`BackupAsyncTask [${this.taskId}]: Error`, err);
    }

    toObject(): IAsyncTaskJSON {
        return {
            taskId: this.taskId,
            type: this.type,
            status: this.status(),
            instanceUuid: this.instance.instanceUuid,
            instanceName: this.instance.config.nickname,
            trigger: this.trigger,
            progress: this.progress,
            result: this.result
        };
    }

    getResult(): IBackupResult | undefined {
        return this.result;
    }

    getProgress(): IBackupProgress {
        return this.progress;
    }
}
