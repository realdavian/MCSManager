/**
 * Google Cloud Storage Provider
 */

import fs from "fs-extra";
import path from "path";
import { $t } from "../../../i18n";
import logger from "../../log";
import {
    IBackupInfo,
    IGCSConfig,
    IStorageProvider,
    IStorageProviderConfig,
    ProgressCallback
} from "./IStorageProvider";

// Note: @google-cloud/storage must be installed
// npm install @google-cloud/storage

export default class GCSStorageProvider implements IStorageProvider {
    public readonly id: string;
    public readonly name: string;
    public readonly type: "s3" | "gcs" = "gcs";

    private config: IGCSConfig;
    private storage: any = null;
    private bucket: any = null;

    constructor(providerConfig: IStorageProviderConfig) {
        if (providerConfig.type !== "gcs") {
            throw new Error("Invalid provider type for GCSStorageProvider");
        }
        this.id = providerConfig.id;
        this.name = providerConfig.name;
        this.config = providerConfig.config as IGCSConfig;
    }

    private async getStorage() {
        if (this.storage) return { storage: this.storage, bucket: this.bucket };

        try {
            // Dynamic import to handle missing dependency gracefully
            const { Storage } = await import("@google-cloud/storage");

            const options: any = {
                projectId: this.config.projectId
            };

            if (this.config.keyFilePath) {
                options.keyFilename = this.config.keyFilePath;
            } else if (this.config.credentials) {
                options.credentials = this.config.credentials;
            }

            this.storage = new Storage(options);
            this.bucket = this.storage.bucket(this.config.bucket);

            return { storage: this.storage, bucket: this.bucket };
        } catch (error: any) {
            logger.error("GCSStorageProvider: Failed to initialize GCS client", error);
            throw new Error($t("TXT_CODE_backup_gcsClientInitError") || "Failed to initialize GCS client");
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const { bucket } = await this.getStorage();
            const [exists] = await bucket.exists();

            if (!exists) {
                logger.error(`GCSStorageProvider [${this.name}]: Bucket does not exist`);
                return false;
            }

            logger.info(`GCSStorageProvider [${this.name}]: Connection test successful`);
            return true;
        } catch (error: any) {
            logger.error(`GCSStorageProvider [${this.name}]: Connection test failed`, error);
            return false;
        }
    }

    async upload(localPath: string, remotePath: string, onProgress?: ProgressCallback): Promise<void> {
        try {
            const { bucket } = await this.getStorage();
            const fileSize = (await fs.stat(localPath)).size;

            const options: any = {
                destination: remotePath,
                resumable: fileSize > 5 * 1024 * 1024, // Use resumable for files > 5MB
                metadata: {
                    contentType: "application/zip"
                }
            };

            if (onProgress && fileSize > 0) {
                // For progress tracking, we need to use streams
                const file = bucket.file(remotePath);
                const writeStream = file.createWriteStream({
                    resumable: options.resumable,
                    metadata: options.metadata
                });

                const readStream = fs.createReadStream(localPath);
                let loaded = 0;

                await new Promise<void>((resolve, reject) => {
                    readStream.on("data", (chunk: Buffer | string) => {
                        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        loaded += chunkBuffer.length;
                        onProgress({
                            loaded,
                            total: fileSize,
                            percent: Math.round((loaded / fileSize) * 100)
                        });
                    });

                    readStream.pipe(writeStream);
                    writeStream.on("finish", resolve);
                    writeStream.on("error", reject);
                    readStream.on("error", reject);
                });
            } else {
                await bucket.upload(localPath, options);
            }

            logger.info(`GCSStorageProvider [${this.name}]: Uploaded ${remotePath}`);
        } catch (error: any) {
            logger.error(`GCSStorageProvider [${this.name}]: Upload failed`, error);
            throw new Error($t("TXT_CODE_backup_uploadFailed") || `Upload failed: ${error.message}`);
        }
    }

    async list(prefix: string): Promise<IBackupInfo[]> {
        try {
            const { bucket } = await this.getStorage();

            const [files] = await bucket.getFiles({ prefix });

            const backups: IBackupInfo[] = [];

            for (const file of files) {
                const filename = path.basename(file.name);
                if (!filename || file.name.endsWith("/")) continue;

                // Parse backup info from filename: instanceUuid_timestamp_trigger.zip
                const parts = filename.replace(".zip", "").split("_");

                const [metadata] = await file.getMetadata();

                backups.push({
                    id: file.name,
                    instanceUuid: parts[0] || "",
                    filename: filename,
                    remotePath: file.name,
                    size: parseInt(metadata.size, 10) || 0,
                    createdAt: new Date(metadata.timeCreated).getTime() || 0,
                    trigger: (parts[2] as "manual" | "scheduled" | "on_stop") || "manual"
                });
            }

            return backups.sort((a, b) => b.createdAt - a.createdAt);
        } catch (error: any) {
            logger.error(`GCSStorageProvider [${this.name}]: List failed`, error);
            throw new Error($t("TXT_CODE_backup_listFailed") || `List failed: ${error.message}`);
        }
    }

    async delete(remotePath: string): Promise<void> {
        try {
            const { bucket } = await this.getStorage();
            await bucket.file(remotePath).delete();
            logger.info(`GCSStorageProvider [${this.name}]: Deleted ${remotePath}`);
        } catch (error: any) {
            logger.error(`GCSStorageProvider [${this.name}]: Delete failed`, error);
            throw new Error($t("TXT_CODE_backup_deleteFailed") || `Delete failed: ${error.message}`);
        }
    }

    async download(
        remotePath: string,
        localPath: string,
        onProgress?: ProgressCallback
    ): Promise<void> {
        try {
            const { bucket } = await this.getStorage();
            const file = bucket.file(remotePath);

            // Get file metadata for size
            const [metadata] = await file.getMetadata();
            const totalSize = parseInt(metadata.size, 10) || 0;

            if (onProgress && totalSize > 0) {
                const readStream = file.createReadStream();
                const writeStream = fs.createWriteStream(localPath);
                let loaded = 0;

                await new Promise<void>((resolve, reject) => {
                    readStream.on("data", (chunk: Buffer | string) => {
                        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        loaded += chunkBuffer.length;
                        onProgress({
                            loaded,
                            total: totalSize,
                            percent: Math.round((loaded / totalSize) * 100)
                        });
                    });

                    readStream.pipe(writeStream);
                    writeStream.on("finish", resolve);
                    writeStream.on("error", reject);
                    readStream.on("error", reject);
                });
            } else {
                await file.download({ destination: localPath });
            }

            logger.info(`GCSStorageProvider [${this.name}]: Downloaded ${remotePath} to ${localPath}`);
        } catch (error: any) {
            logger.error(`GCSStorageProvider [${this.name}]: Download failed`, error);
            throw new Error($t("TXT_CODE_backup_downloadFailed") || `Download failed: ${error.message}`);
        }
    }
}
