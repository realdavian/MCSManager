/**
 * Storage Provider Interface
 * Defines the contract for cloud storage providers (S3, GCS, etc.)
 */

export interface IBackupInfo {
    id: string;
    instanceUuid: string;
    filename: string;
    remotePath: string;
    size: number;
    createdAt: number;
    trigger: "manual" | "scheduled" | "on_stop";
}

export interface IStorageProviderConfig {
    id: string;
    name: string;
    type: "s3" | "gcs";
    config: IS3Config | IGCSConfig;
}

export interface IS3Config {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string; // For S3-compatible services (MinIO, BackBlaze B2)
    forcePathStyle?: boolean;
}

export interface IGCSConfig {
    bucket: string;
    projectId: string;
    keyFilePath?: string; // Path to service account JSON
    credentials?: {
        client_email: string;
        private_key: string;
    };
}

export interface IUploadProgress {
    loaded: number;
    total: number;
    percent: number;
}

export type ProgressCallback = (progress: IUploadProgress) => void;

export interface IStorageProvider {
    readonly id: string;
    readonly name: string;
    readonly type: "s3" | "gcs";

    /**
     * Test connection to the storage provider
     */
    testConnection(): Promise<boolean>;

    /**
     * Upload a file to remote storage
     * @param localPath Absolute path to the local file
     * @param remotePath Path in the remote bucket (e.g., "backups/instance-uuid/backup.zip")
     * @param onProgress Optional progress callback
     */
    upload(localPath: string, remotePath: string, onProgress?: ProgressCallback): Promise<void>;

    /**
     * List backups for an instance
     * @param prefix Remote path prefix (e.g., "backups/instance-uuid/")
     */
    list(prefix: string): Promise<IBackupInfo[]>;

    /**
     * Delete a backup from remote storage
     * @param remotePath Full path to the remote file
     */
    delete(remotePath: string): Promise<void>;

    /**
     * Download a backup from remote storage
     * @param remotePath Full path to the remote file
     * @param localPath Absolute path to save locally
     * @param onProgress Optional progress callback
     */
    download(remotePath: string, localPath: string, onProgress?: ProgressCallback): Promise<void>;
}
