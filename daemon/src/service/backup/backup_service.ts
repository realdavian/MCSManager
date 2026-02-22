/**
 * Backup Service
 * Central service for managing instance backups
 */

import fs from "fs-extra";
import path from "path";
import { compress } from "../../common/compress";
import { globalConfiguration } from "../../entity/config";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import logger from "../log";
import GCSStorageProvider from "./providers/GCSStorageProvider";
import {
    IBackupInfo,
    IStorageProvider,
    IStorageProviderConfig,
    ProgressCallback
} from "./providers/IStorageProvider";
import S3StorageProvider from "./providers/S3StorageProvider";

// Backup temporary directory
const BACKUP_TEMP_DIR = path.join(process.cwd(), "data", "BackupTemp");

export type BackupTrigger = "manual" | "scheduled" | "on_stop";

export interface IBackupResult {
    success: boolean;
    backupId?: string;
    remotePath?: string;
    size?: number;
    error?: string;
}

export interface IBackupProgress {
    phase: "compressing" | "uploading" | "complete" | "error";
    percent: number;
    message?: string;
}

export type BackupProgressCallback = (progress: IBackupProgress) => void;

class BackupService {
    private providers: Map<string, IStorageProvider> = new Map();

    constructor() {
        // Ensure temp directory exists
        fs.ensureDirSync(BACKUP_TEMP_DIR);
    }

    /**
     * Initialize providers from global configuration
     */
    public initProviders(): void {
        const configs = globalConfiguration.config.storageProviders || [];
        this.providers.clear();

        for (const config of configs) {
            try {
                const provider = this.createProvider(config);
                this.providers.set(config.id, provider);
                logger.info(`BackupService: Initialized provider [${config.name}] (${config.type})`);
            } catch (error: any) {
                logger.error(`BackupService: Failed to initialize provider [${config.name}]`, error);
            }
        }
    }

    /**
     * Create a provider instance from config
     */
    private createProvider(config: IStorageProviderConfig): IStorageProvider {
        switch (config.type) {
            case "s3":
                return new S3StorageProvider(config);
            case "gcs":
                return new GCSStorageProvider(config);
            default:
                throw new Error(`Unknown provider type: ${(config as any).type}`);
        }
    }

    /**
     * Get a provider by ID
     */
    public getProvider(providerId: string): IStorageProvider | undefined {
        return this.providers.get(providerId);
    }

    /**
     * Get all providers
     */
    public getProviders(): IStorageProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Add a new provider
     */
    public addProvider(config: IStorageProviderConfig): void {
        // Add to global config
        const configs = globalConfiguration.config.storageProviders || [];
        configs.push(config);
        globalConfiguration.config.storageProviders = configs;
        globalConfiguration.store();

        // Create and cache provider
        const provider = this.createProvider(config);
        this.providers.set(config.id, provider);

        logger.info(`BackupService: Added provider [${config.name}] (${config.type})`);
    }

    /**
     * Remove a provider
     */
    public removeProvider(providerId: string): boolean {
        const configs = globalConfiguration.config.storageProviders || [];
        const index = configs.findIndex((c) => c.id === providerId);

        if (index === -1) return false;

        configs.splice(index, 1);
        globalConfiguration.config.storageProviders = configs;
        globalConfiguration.store();

        this.providers.delete(providerId);
        logger.info(`BackupService: Removed provider [${providerId}]`);
        return true;
    }

    /**
     * Test a provider connection
     */
    public async testProvider(providerId: string): Promise<boolean> {
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new Error($t("TXT_CODE_backup_providerNotFound") || "Provider not found");
        }
        return provider.testConnection();
    }

    /**
     * Create a backup for an instance
     */
    public async createBackup(
        instance: Instance,
        trigger: BackupTrigger,
        selectedPaths?: string[],
        onProgress?: BackupProgressCallback
    ): Promise<IBackupResult> {
        const instanceUuid = instance.instanceUuid;
        const backupConfig = instance.config.backupConfig;

        if (!backupConfig?.enabled) {
            return { success: false, error: "Backup not enabled for this instance" };
        }

        const provider = this.providers.get(backupConfig.providerId);
        if (!provider) {
            return {
                success: false,
                error: $t("TXT_CODE_backup_providerNotFound") || "Provider not found"
            };
        }

        const timestamp = Date.now();
        const backupId = `${instanceUuid}_${timestamp}_${trigger}`;
        const zipFilename = `${backupId}.zip`;
        const localZipPath = path.join(BACKUP_TEMP_DIR, zipFilename);
        const remotePath = `backups/${instanceUuid}/${zipFilename}`;

        try {
            // Phase 1: Compression
            onProgress?.({ phase: "compressing", percent: 0, message: "Starting compression..." });

            const cwdPath = instance.absoluteCwdPath();
            const pathsToBackup = selectedPaths?.length ? selectedPaths : backupConfig.selectedPaths || [];

            // If no specific paths, backup the entire directory
            const filesToCompress =
                pathsToBackup.length > 0
                    ? pathsToBackup.map((p) => path.join(cwdPath, p))
                    : [cwdPath];

            // Create the zip file
            // Note: compress expects files relative to the zip output directory
            // We need to handle this differently for full directory backup
            await this.compressFiles(cwdPath, filesToCompress, localZipPath);

            onProgress?.({ phase: "compressing", percent: 100, message: "Compression complete" });

            // Phase 2: Upload
            onProgress?.({ phase: "uploading", percent: 0, message: "Starting upload..." });

            const uploadProgress: ProgressCallback = (progress) => {
                onProgress?.({
                    phase: "uploading",
                    percent: progress.percent,
                    message: `Uploading: ${progress.percent}%`
                });
            };

            await provider.upload(localZipPath, remotePath, uploadProgress);

            // Get file size
            const stats = await fs.stat(localZipPath);

            // Cleanup temp file
            await fs.remove(localZipPath);

            onProgress?.({ phase: "complete", percent: 100, message: "Backup complete" });

            logger.info(
                `BackupService: Created backup for [${instance.config.nickname}] -> ${remotePath}`
            );

            return {
                success: true,
                backupId,
                remotePath,
                size: stats.size
            };
        } catch (error: any) {
            // Cleanup on error
            try {
                await fs.remove(localZipPath);
            } catch { }

            onProgress?.({ phase: "error", percent: 0, message: error.message });

            logger.error(`BackupService: Backup failed for [${instance.config.nickname}]`, error);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Compress files/directories to a zip file
     */
    private async compressFiles(
        basePath: string,
        paths: string[],
        outputPath: string
    ): Promise<void> {
        // The compress function from common/compress.ts expects:
        // - sourceZip: output zip path
        // - files: array of file/folder names (relative to zip output dir or cwd)

        // For our use case, we need to work from the instance cwd
        const originalCwd = process.cwd();

        try {
            // Change to base path for compression
            process.chdir(basePath);

            // Get relative paths
            const relativePaths = paths.map((p) => {
                if (path.isAbsolute(p)) {
                    return path.relative(basePath, p);
                }
                return p;
            });

            // If compressing entire directory, use "." or list all contents
            const filesToCompress = relativePaths.length > 0 ? relativePaths : ["."];

            await compress(outputPath, filesToCompress);
        } finally {
            process.chdir(originalCwd);
        }
    }

    /**
     * List backups for an instance
     */
    public async listBackups(instanceUuid: string, providerId: string): Promise<IBackupInfo[]> {
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new Error($t("TXT_CODE_backup_providerNotFound") || "Provider not found");
        }

        const prefix = `backups/${instanceUuid}/`;
        return provider.list(prefix);
    }

    /**
     * Delete a backup
     */
    public async deleteBackup(providerId: string, remotePath: string): Promise<void> {
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new Error($t("TXT_CODE_backup_providerNotFound") || "Provider not found");
        }

        await provider.delete(remotePath);
        logger.info(`BackupService: Deleted backup ${remotePath}`);
    }

    /**
     * Cleanup old temp files
     */
    public async cleanupTempFiles(): Promise<void> {
        try {
            const files = await fs.readdir(BACKUP_TEMP_DIR);
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            for (const file of files) {
                const filePath = path.join(BACKUP_TEMP_DIR, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtimeMs > maxAge) {
                    await fs.remove(filePath);
                    logger.info(`BackupService: Cleaned up old temp file ${file}`);
                }
            }
        } catch (error: any) {
            logger.warn("BackupService: Error cleaning up temp files", error);
        }
    }
}

// Singleton instance
const backupService = new BackupService();
export default backupService;
