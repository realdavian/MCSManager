/**
 * S3 Storage Provider
 * Supports AWS S3 and S3-compatible services (MinIO, Backblaze B2, etc.)
 */

import fs from "fs-extra";
import path from "path";
import { $t } from "../../../i18n";
import logger from "../../log";
import {
    IBackupInfo,
    IS3Config,
    IStorageProvider,
    IStorageProviderConfig,
    ProgressCallback
} from "./IStorageProvider";

// Note: @aws-sdk/client-s3 and @aws-sdk/lib-storage must be installed
// npm install @aws-sdk/client-s3 @aws-sdk/lib-storage

export default class S3StorageProvider implements IStorageProvider {
    public readonly id: string;
    public readonly name: string;
    public readonly type: "s3" | "gcs" = "s3";

    private config: IS3Config;
    private s3Client: any = null;

    constructor(providerConfig: IStorageProviderConfig) {
        if (providerConfig.type !== "s3") {
            throw new Error("Invalid provider type for S3StorageProvider");
        }
        this.id = providerConfig.id;
        this.name = providerConfig.name;
        this.config = providerConfig.config as IS3Config;
    }

    private async getClient() {
        if (this.s3Client) return this.s3Client;

        try {
            // Dynamic import to handle missing dependency gracefully
            const { S3Client } = await import("@aws-sdk/client-s3");

            this.s3Client = new S3Client({
                region: this.config.region,
                credentials: {
                    accessKeyId: this.config.accessKeyId,
                    secretAccessKey: this.config.secretAccessKey
                },
                endpoint: this.config.endpoint,
                forcePathStyle: this.config.forcePathStyle ?? !!this.config.endpoint
            });

            return this.s3Client;
        } catch (error: any) {
            logger.error("S3StorageProvider: Failed to initialize S3 client", error);
            throw new Error($t("TXT_CODE_backup_s3ClientInitError") || "Failed to initialize S3 client");
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const client = await this.getClient();
            const { HeadBucketCommand } = await import("@aws-sdk/client-s3");

            await client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
            logger.info(`S3StorageProvider [${this.name}]: Connection test successful`);
            return true;
        } catch (error: any) {
            logger.error(`S3StorageProvider [${this.name}]: Connection test failed`, error);
            return false;
        }
    }

    async upload(localPath: string, remotePath: string, onProgress?: ProgressCallback): Promise<void> {
        try {
            const client = await this.getClient();
            const { Upload } = await import("@aws-sdk/lib-storage");

            const fileSize = (await fs.stat(localPath)).size;
            const fileStream = fs.createReadStream(localPath);

            const upload = new Upload({
                client,
                params: {
                    Bucket: this.config.bucket,
                    Key: remotePath,
                    Body: fileStream,
                    ContentType: "application/zip"
                },
                queueSize: 4,
                partSize: 1024 * 1024 * 5, // 5MB chunks
                leavePartsOnError: false
            });

            if (onProgress) {
                upload.on("httpUploadProgress", (progress: any) => {
                    onProgress({
                        loaded: progress.loaded || 0,
                        total: fileSize,
                        percent: fileSize > 0 ? Math.round(((progress.loaded || 0) / fileSize) * 100) : 0
                    });
                });
            }

            await upload.done();
            logger.info(`S3StorageProvider [${this.name}]: Uploaded ${remotePath}`);
        } catch (error: any) {
            logger.error(`S3StorageProvider [${this.name}]: Upload failed`, error);
            throw new Error($t("TXT_CODE_backup_uploadFailed") || `Upload failed: ${error.message}`);
        }
    }

    async list(prefix: string): Promise<IBackupInfo[]> {
        try {
            const client = await this.getClient();
            const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

            const response = await client.send(
                new ListObjectsV2Command({
                    Bucket: this.config.bucket,
                    Prefix: prefix
                })
            );

            const backups: IBackupInfo[] = [];

            for (const object of response.Contents || []) {
                if (!object.Key || object.Key.endsWith("/")) continue;

                // Parse backup info from filename: instanceUuid_timestamp_trigger.zip
                const filename = path.basename(object.Key);
                const parts = filename.replace(".zip", "").split("_");

                backups.push({
                    id: object.Key,
                    instanceUuid: parts[0] || "",
                    filename: filename,
                    remotePath: object.Key,
                    size: object.Size || 0,
                    createdAt: object.LastModified?.getTime() || 0,
                    trigger: (parts[2] as "manual" | "scheduled" | "on_stop") || "manual"
                });
            }

            return backups.sort((a, b) => b.createdAt - a.createdAt);
        } catch (error: any) {
            logger.error(`S3StorageProvider [${this.name}]: List failed`, error);
            throw new Error($t("TXT_CODE_backup_listFailed") || `List failed: ${error.message}`);
        }
    }

    async delete(remotePath: string): Promise<void> {
        try {
            const client = await this.getClient();
            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

            await client.send(
                new DeleteObjectCommand({
                    Bucket: this.config.bucket,
                    Key: remotePath
                })
            );

            logger.info(`S3StorageProvider [${this.name}]: Deleted ${remotePath}`);
        } catch (error: any) {
            logger.error(`S3StorageProvider [${this.name}]: Delete failed`, error);
            throw new Error($t("TXT_CODE_backup_deleteFailed") || `Delete failed: ${error.message}`);
        }
    }

    async download(
        remotePath: string,
        localPath: string,
        onProgress?: ProgressCallback
    ): Promise<void> {
        try {
            const client = await this.getClient();
            const { GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");

            // Get file size first
            const headResponse = await client.send(
                new HeadObjectCommand({
                    Bucket: this.config.bucket,
                    Key: remotePath
                })
            );
            const totalSize = headResponse.ContentLength || 0;

            // Download the file
            const response = await client.send(
                new GetObjectCommand({
                    Bucket: this.config.bucket,
                    Key: remotePath
                })
            );

            const writeStream = fs.createWriteStream(localPath);
            const body = response.Body;

            if (!body) {
                throw new Error("Empty response body");
            }

            let loaded = 0;

            await new Promise<void>((resolve, reject) => {
                const readable = body as NodeJS.ReadableStream;

                readable.on("data", (chunk: Buffer) => {
                    loaded += chunk.length;
                    if (onProgress) {
                        onProgress({
                            loaded,
                            total: totalSize,
                            percent: totalSize > 0 ? Math.round((loaded / totalSize) * 100) : 0
                        });
                    }
                });

                readable.pipe(writeStream);
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
                readable.on("error", reject);
            });

            logger.info(`S3StorageProvider [${this.name}]: Downloaded ${remotePath} to ${localPath}`);
        } catch (error: any) {
            logger.error(`S3StorageProvider [${this.name}]: Download failed`, error);
            throw new Error($t("TXT_CODE_backup_downloadFailed") || `Download failed: ${error.message}`);
        }
    }
}
