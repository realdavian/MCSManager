import { useDefineApi } from "@/stores/useDefineApi";

// ==================== Provider Management ====================

export interface BackupProvider {
    id: string;
    name: string;
    type: "s3" | "gcs";
}

export interface S3Config {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
}

export interface GCSConfig {
    bucket: string;
    projectId: string;
    keyFilename?: string;
    credentials?: object;
}

export const getBackupProviders = useDefineApi<
    {
        params: {
            daemonId: string;
        };
    },
    {
        providers: BackupProvider[];
    }
>({
    url: "/api/backup/providers",
    method: "GET"
});

export const addBackupProvider = useDefineApi<
    {
        params: {
            daemonId: string;
        };
        data: {
            name: string;
            type: "s3" | "gcs";
            config: S3Config | GCSConfig;
        };
    },
    BackupProvider
>({
    url: "/api/backup/providers",
    method: "POST"
});

export const testBackupProvider = useDefineApi<
    {
        params: {
            daemonId: string;
            providerId: string;
        };
    },
    {
        success: boolean;
    }
>({
    url: "/api/backup/providers/test",
    method: "POST"
});

export const updateBackupProvider = useDefineApi<
    {
        params: {
            daemonId: string;
            providerId: string;
        };
        data: {
            name?: string;
            config?: Partial<S3Config | GCSConfig>;
        };
    },
    BackupProvider
>({
    url: "/api/backup/providers",
    method: "PUT"
});

export const deleteBackupProvider = useDefineApi<
    {
        params: {
            daemonId: string;
            providerId: string;
        };
    },
    {
        success: boolean;
    }
>({
    url: "/api/backup/providers",
    method: "DELETE"
});

// ==================== Backup Operations ====================

export interface BackupInfo {
    name: string;
    remotePath: string;
    size: number;
    lastModified: string;
    trigger: "manual" | "scheduled" | "on-stop";
}

export interface BackupTaskStatus {
    taskId: string;
    status: number;
    progress?: number;
    result?: {
        success: boolean;
        remotePath?: string;
        error?: string;
    };
}

export const createBackup = useDefineApi<
    {
        params: {
            daemonId: string;
            instanceUuid: string;
        };
        data?: {
            selectedPaths?: string[];
        };
    },
    {
        taskId: string;
        instanceUuid: string;
    }
>({
    url: "/api/backup/create",
    method: "POST"
});

export const getBackupStatus = useDefineApi<
    {
        params: {
            daemonId: string;
            taskId: string;
        };
    },
    BackupTaskStatus
>({
    url: "/api/backup/status",
    method: "GET"
});

export const listBackups = useDefineApi<
    {
        params: {
            daemonId: string;
            instanceUuid: string;
            providerId: string;
        };
    },
    {
        backups: BackupInfo[];
    }
>({
    url: "/api/backup/list",
    method: "GET"
});

export const deleteBackup = useDefineApi<
    {
        params: {
            daemonId: string;
            providerId: string;
            remotePath: string;
        };
    },
    {
        success: boolean;
    }
>({
    url: "/api/backup/delete",
    method: "DELETE"
});
