/**
 * Provider Router
 * WebSocket router for storage provider management
 */

import { v4 as uuidv4 } from "uuid";
import { globalConfiguration } from "../entity/config";
import { $t } from "../i18n";
import backupService from "../service/backup/backup_service";
import { IStorageProviderConfig } from "../service/backup/providers/IStorageProvider";
import logger from "../service/log";
import { response, responseError } from "../service/protocol";
import { routerApp } from "../service/router";

// List all storage providers
routerApp.on("provider/list", async (ctx, data) => {
    try {
        const providers = backupService.getProviders().map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type
        }));

        response(ctx, { providers });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Add a new storage provider
routerApp.on("provider/add", async (ctx, data) => {
    try {
        const { name, type, config } = data;

        if (!name || !type || !config) {
            throw new Error($t("TXT_CODE_backup_invalidProviderConfig") || "Invalid provider configuration");
        }

        if (!["s3", "gcs"].includes(type)) {
            throw new Error($t("TXT_CODE_backup_unsupportedProviderType") || "Unsupported provider type");
        }

        const providerConfig: IStorageProviderConfig = {
            id: uuidv4(),
            name,
            type,
            config
        };

        backupService.addProvider(providerConfig);

        response(ctx, {
            id: providerConfig.id,
            name: providerConfig.name,
            type: providerConfig.type
        });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Test a provider connection
routerApp.on("provider/test", async (ctx, data) => {
    try {
        const providerId = data.providerId;

        if (!providerId) {
            throw new Error($t("TXT_CODE_backup_providerIdRequired") || "Provider ID is required");
        }

        const success = await backupService.testProvider(providerId);

        response(ctx, { success });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Delete a provider
routerApp.on("provider/delete", async (ctx, data) => {
    try {
        const providerId = data.providerId;

        if (!providerId) {
            throw new Error($t("TXT_CODE_backup_providerIdRequired") || "Provider ID is required");
        }

        const success = backupService.removeProvider(providerId);

        if (!success) {
            throw new Error($t("TXT_CODE_backup_providerNotFound") || "Provider not found");
        }

        response(ctx, { success: true });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

// Update a provider
routerApp.on("provider/update", async (ctx, data) => {
    try {
        const { providerId, name, config: newConfig } = data;

        if (!providerId) {
            throw new Error($t("TXT_CODE_backup_providerIdRequired") || "Provider ID is required");
        }

        // Get current config
        const configs = globalConfiguration.config.storageProviders || [];
        const index = configs.findIndex((c) => c.id === providerId);

        if (index === -1) {
            throw new Error($t("TXT_CODE_backup_providerNotFound") || "Provider not found");
        }

        // Update config
        if (name) configs[index].name = name;
        if (newConfig) configs[index].config = { ...configs[index].config, ...newConfig };

        globalConfiguration.store();

        // Reinitialize providers
        backupService.initProviders();

        response(ctx, {
            id: configs[index].id,
            name: configs[index].name,
            type: configs[index].type
        });
    } catch (error: any) {
        responseError(ctx, error);
    }
});

logger.info("ProviderRouter: Provider router initialized");
