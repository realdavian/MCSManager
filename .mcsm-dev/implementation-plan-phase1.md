# Remote Backup Module - Phase 1

**Scope**: Backup to remote storage (S3 + GCS) with on-stop, scheduled, and manual triggers.  
**Out of Scope**: Restoration (Phase 2), Retention policy (Backlog)

---

## Open Questions

> [!IMPORTANT]
> **Minimum Schedule Interval**: Is 60 minutes acceptable?

---

## Backend Components (✅ Implemented)

### 1. Storage Provider Abstraction

| Status | File | Description |
|--------|------|-------------|
| ✅ | `daemon/src/service/backup/providers/IStorageProvider.ts` | Interface and types |
| ✅ | `daemon/src/service/backup/providers/S3StorageProvider.ts` | S3-compatible provider |
| ✅ | `daemon/src/service/backup/providers/GCSStorageProvider.ts` | GCS provider |

### 2. Backup Service & Task

| Status | File | Description |
|--------|------|-------------|
| ✅ | `daemon/src/service/backup/backup_service.ts` | Central backup service |
| ✅ | `daemon/src/service/async_task_service/backup_task.ts` | Async task wrapper |

### 3. Commands & Lifecycle

| Status | File | Description |
|--------|------|-------------|
| ✅ | `daemon/src/entity/commands/general/backup_command.ts` | Manual backup command |
| ✅ | `daemon/src/entity/commands/task/backup_lifecycle.ts` | Scheduled/on-stop backups |

### 4. Routers

| Status | File | Description |
|--------|------|-------------|
| ✅ | `daemon/src/routers/backup_router.ts` | WebSocket router |
| ✅ | `daemon/src/routers/provider_router.ts` | Provider CRUD router |
| ✅ | `panel/src/app/routers/backup_router.ts` | Panel REST proxy |

### 5. Config & Types

| Status | File | Description |
|--------|------|-------------|
| ✅ | `common/global.d.ts` | Added `backupConfig` type |
| ✅ | `daemon/src/entity/instance/Instance_config.ts` | Added backup config |
| ✅ | `daemon/src/entity/config.ts` | Added `storageProviders` |

### 6. i18n

| Status | File | Description |
|--------|------|-------------|
| ✅ | `languages/en_US.json` | 27 backup strings added |

---

## Frontend Components (🔲 To Implement)

### 11. API Service Layer

#### [NEW] `frontend/src/services/apis/backup.ts`

API composables for backup operations:

```typescript
// Provider management (admin only)
export const getBackupProviders = useDefineApi<...>({ url: "/api/backup/providers", method: "GET" });
export const addBackupProvider = useDefineApi<...>({ url: "/api/backup/providers", method: "POST" });
export const testBackupProvider = useDefineApi<...>({ url: "/api/backup/providers/test", method: "POST" });
export const deleteBackupProvider = useDefineApi<...>({ url: "/api/backup/providers", method: "DELETE" });

// Backup operations
export const createBackup = useDefineApi<...>({ url: "/api/backup/create", method: "POST" });
export const getBackupStatus = useDefineApi<...>({ url: "/api/backup/status", method: "GET" });
export const listBackups = useDefineApi<...>({ url: "/api/backup/list", method: "GET" });
export const deleteBackup = useDefineApi<...>({ url: "/api/backup/delete", method: "DELETE" });
```

---

### 12. Instance Backup Settings Dialog

#### [NEW] `frontend/src/widgets/instance/dialogs/BackupSettings.vue`

> [!NOTE]
> **Design Decision**: Separate dialog (like `RconSettings.vue`) rather than integrating into `InstanceDetail.vue` because:
> - InstanceDetail.vue is already 1322 lines / 54KB
> - Backup is an optional feature, similar to RCON
> - Follows existing patterns for optional features

Modal dialog for configuring instance backup:

**UI Elements:**
- Enable/disable backup toggle
- Provider dropdown (fetched from daemon)
- Schedule toggle + interval input
- On-stop backup toggle
- Path selection button (opens file browser)
- Manual backup trigger button

**Props:**
```typescript
defineProps<{
  instanceInfo?: InstanceDetail;
  instanceId?: string;
  daemonId?: string;
}>();
```

**Form Data:**
```typescript
const formData = reactive({
  enabled: false,
  providerId: "",
  scheduledBackup: false,
  scheduleInterval: 360,
  onStopBackup: true,
  selectedPaths: [] as string[]
});
```

---

### 13. Instance Backup List Dialog

#### [NEW] `frontend/src/widgets/instance/dialogs/BackupList.vue`

Modal showing existing backups with actions:

**UI Elements:**
- Table with columns: Filename, Size, Created At, Trigger Type
- Delete button per row
- Refresh button
- Progress indicator for active backup

---

### 14. Shortcut Button Integration

#### [MODIFY] `frontend/src/widgets/instance/Shortcut.vue`

Add backup buttons to the instance shortcut panel:

- "Backup Settings" button → Opens `BackupSettings.vue`
- "View Backups" button → Opens `BackupList.vue`
- "Backup Now" button → Triggers manual backup

---

### 15. Admin Provider Management (Settings Tab)

> [!NOTE]
> **Design Decision**: Add as a new tab in `Settings.vue` rather than a separate page for better discoverability and consistency with existing settings organization.

#### [MODIFY] `frontend/src/widgets/Settings.vue`

Add "Backup" item to the `menus` array:
```typescript
{
  title: t("TXT_CODE_backup.providers"),
  key: "backup",
  icon: CloudUploadOutlined
}
```

Add corresponding `<template #backup>` slot with provider management UI:

**UI Elements:**
- List of configured providers (name, type, test/delete actions)
- "Add Provider" button → Opens provider configuration form
- Connection test button with status indicator

**Provider Form Fields (for S3):**
- Provider Name
- Bucket Name
- Region
- Access Key ID
- Secret Access Key
- Endpoint (optional, for S3-compatible services)

**Provider Form Fields (for GCS):**
- Provider Name
- Bucket Name
- Project ID
- Service Account Key (file upload or paste JSON)

---

### 16. Frontend i18n

#### [MODIFY] `languages/en_US.json`

Add UI-specific strings:

```json
"TXT_CODE_backup.settings": "Backup Settings",
"TXT_CODE_backup.viewBackups": "View Backups",
"TXT_CODE_backup.backupNow": "Backup Now",
"TXT_CODE_backup.providers": "Storage Providers",
"TXT_CODE_backup.addProvider": "Add Provider",
"TXT_CODE_backup.testConnection": "Test Connection",
"TXT_CODE_backup.selectPaths": "Select Paths to Backup",
"TXT_CODE_backup.scheduleInterval": "Backup Interval (minutes)",
"TXT_CODE_backup.onStopBackup": "Backup on Instance Stop",
"TXT_CODE_backup.noBackups": "No backups found",
"TXT_CODE_backup.confirmDelete": "Are you sure you want to delete this backup?",
"TXT_CODE_backup.providerType": "Provider Type",
"TXT_CODE_backup.bucketName": "Bucket Name",
"TXT_CODE_backup.s3Region": "Region",
"TXT_CODE_backup.s3AccessKey": "Access Key ID",
"TXT_CODE_backup.s3SecretKey": "Secret Access Key",
"TXT_CODE_backup.gcsProjectId": "Project ID",
"TXT_CODE_backup.gcsKeyFile": "Service Account Key File"
```

---

## Dependencies

```json
{
  "@aws-sdk/client-s3": "^3.x",
  "@aws-sdk/lib-storage": "^3.x",
  "@google-cloud/storage": "^7.x"
}
```

---

## Implementation Order

### Backend (✅ Complete)
1. ✅ Provider Interface + S3 + GCS
2. ✅ Backup Service
3. ✅ Instance Config extension
4. ✅ Backup Async Task
5. ✅ Lifecycle Task
6. ✅ Manual Backup Command
7. ✅ Schedule Action
8. ✅ Daemon Routers
9. ✅ Panel Proxy
10. ✅ Backend i18n

### Frontend (🔲 Pending)
11. API service layer (`backup.ts`)
12. Backup settings dialog (`BackupSettings.vue`)
13. Backup list dialog (`BackupList.vue`)
14. Shortcut integration
15. Admin provider management
16. Frontend i18n strings

---

## Verification Plan

### Manual Testing (Recommended)

Since this feature involves cloud storage credentials and instance lifecycle, manual testing is most appropriate:

#### Test 1: Provider Management (Admin)
1. Start MCSManager (`npm run dev` in daemon and panel directories)
2. Log in as admin
3. Navigate to Settings → Backup (new menu item)
4. Click "Add Provider" and configure S3 or GCS
5. Click "Test Connection" - should show success/failure
6. Verify provider appears in the list

#### Test 2: Instance Backup Configuration
1. Navigate to an instance's terminal page
2. Click "Backup Settings" in the shortcut panel
3. Enable backup and select the provider
4. Configure schedule (e.g., every 60 minutes)
5. Enable "Backup on Instance Stop"
6. Save settings
7. Verify settings persist after page refresh

#### Test 3: Manual Backup
1. Click "Backup Now" on an instance
2. Observe progress indicator
3. Verify backup appears in "View Backups" dialog
4. Check cloud storage bucket for the uploaded file

#### Test 4: On-Stop Backup
1. Start an instance with on-stop backup enabled
2. Stop the instance via UI
3. Check instance terminal for backup messages
4. Verify new backup in "View Backups" dialog

> [!NOTE]
> For automated testing, consider adding API-level tests using a mock S3 server (e.g., MinIO) in a future iteration.

