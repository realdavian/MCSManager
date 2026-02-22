# Feasibility Analysis: Remote Backup Module Phase 1

## Executive Summary

✅ **FEASIBLE** - The implementation plan is technically sound and can proceed to development.

---

## Verification Checklist

### 1. Dependencies

| Dependency | Required | Status | Notes |
|------------|----------|--------|-------|
| `@aws-sdk/client-s3` | Yes | ❌ Not installed | Need to add to `daemon/package.json` |
| `@aws-sdk/lib-storage` | Yes | ❌ Not installed | Need to add to `daemon/package.json` |
| `@google-cloud/storage` | Yes | ❌ Not installed | Need to add to `daemon/package.json` |
| `archiver` | No (existing) | ✅ Already installed | v5.3.1 - can use for ZIP if Go binary fails |
| `compressing` | No (existing) | ✅ Already installed | v1.10.0 - alternative compression |

**Action Required:** Add 3 new dependencies to `daemon/package.json`

---

### 2. Type Definitions

| Type | File | Status | Notes |
|------|------|--------|-------|
| `IGlobalInstanceConfig` | `common/global.d.ts` | ⚠️ Needs update | Add `backupConfig` field |
| `InstanceConfig` | `daemon/src/entity/instance/Instance_config.ts` | ⚠️ Needs update | Add `backupConfig` property |
| `IPresetCommand` | `daemon/src/entity/commands/dispatcher.ts` | ⚠️ Needs update | Add `"backup"` to union type |

**Action Required:** Update type definitions in 3 files

---

### 3. Router Registration

**Pattern verified in:** `daemon/src/service/router.ts`

```typescript
// Current pattern (lines 75-83):
import "../routers/auth_router";
import "../routers/Instance_router";
// ...

// To add:
import "../routers/backup_router";
import "../routers/provider_router";
```

✅ **Compatible** - Simple import statement addition

---

### 4. FunctionDispatcher Integration

**Pattern verified in:** `daemon/src/entity/commands/dispatcher.ts`

```typescript
// Current pattern (lines 46-55):
instance.lifeCycleTaskManager.registerLifeCycleTask(new TimeCheck());
instance.setPreset("command", new GeneralSendCommand());
instance.setPreset("install", new GeneralInstallCommand());

// To add:
instance.setPreset("backup", new BackupCommand());
if (instance.config.backupConfig?.enabled) {
  instance.lifeCycleTaskManager.registerLifeCycleTask(new BackupLifeCycleTask());
}
```

✅ **Compatible** - Follows existing patterns exactly

---

### 5. AsyncTask Pattern

**Pattern verified in:** `daemon/src/service/async_task_service/index.ts`

```typescript
// Existing pattern:
export abstract class AsyncTask extends EventEmitter implements IAsyncTask, IExecutable {
  public abstract onStart(): Promise<void>;
  public abstract onStop(): Promise<void>;
  public abstract onError(err: Error): Promise<void>;
  public abstract toObject(): IAsyncTaskJSON;
}

// TaskCenter usage:
TaskCenter.addTask(task);
TaskCenter.getTask(taskId);
```

✅ **Compatible** - `BackupAsyncTask` can extend `AsyncTask` directly

---

### 6. Instance Config Extension

**Pattern verified in:** `daemon/src/entity/instance/instance.ts` (lines 132-251)

```typescript
// Current pattern in parameters():
if (cfg.docker) {
  configureEntityParams(this.config.docker, cfg.docker, "image", String);
  // ...
}

// To add:
if (cfg.backupConfig) {
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "enabled", Boolean);
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "providerId", String);
  // ...
}
```

✅ **Compatible** - Uses `configureEntityParams` utility from `mcsmanager-common`

---

### 7. Global Configuration

**Pattern verified in:** `daemon/src/entity/config.ts`

```typescript
// Current pattern:
class Config {
  public version = 2;
  public ip = "";
  // ...
}

// To add:
public storageProviders: IStorageProviderConfig[] = [];
```

✅ **Compatible** - Simple property addition, persistence handled by existing `load()`/`store()`

---

### 8. Lifecycle Task

**Pattern verified in:** `daemon/src/entity/instance/life_cycle.ts`

```typescript
// Interface matches plan:
export interface ILifeCycleTask {
  name: string;
  status: number;
  start: (instance: Instance) => Promise<void>;
  stop: (instance: Instance) => Promise<void>;
}
```

**Trigger points verified in:** `daemon/src/entity/instance/instance.ts`
- Line 335: `started()` → `execLifeCycleTask(1)`
- Line 361: `stopped()` → `execLifeCycleTask(0)`

✅ **Compatible** - On-stop backup will trigger correctly

---

### 9. Schedule System Extension

**Pattern verified in:** `daemon/src/service/system_instance_control.ts`

```typescript
// Current enum (lines 10-17):
export enum ScheduleActionTypeEnum {
  Delay = "delay",
  Command = "command",
  Stop = "stop",
  Start = "start",
  Restart = "restart",
  Kill = "kill"
}

// Action handler pattern (lines 198-256):
if (actionType === ScheduleActionTypeEnum.Start) {
  if (instanceStatus === Instance.STATUS_STOP) {
    await instance.execPreset("start");
  }
  continue;
}
```

✅ **Compatible** - Add `Backup = "backup"` and handler

---

### 10. Panel Proxy Pattern

**Pattern verified in:** Panel routers (e.g., `instance_admin_router.ts`)

```typescript
// Existing pattern:
router.post("/", async (ctx) => {
  const result = await new RemoteRequest(remoteService).request("instance/new", config);
});
```

✅ **Compatible** - Panel proxy follows standard `RemoteRequest` pattern

---

## Risks & Mitigations

### Risk 1: Compression for Large Directories
**Risk:** Go binary may timeout for large instance directories  
**Mitigation:** 
- Use `ZIP_TIMEOUT_SECONDS` constant (configurable)
- Consider chunked compression or `selectedPaths` to limit scope
- Add progress events to AsyncTask

### Risk 2: Cloud SDK Bundle Size
**Risk:** AWS/GCS SDKs may significantly increase bundle size  
**Mitigation:**
- Consider lazy loading providers
- Tree-shaking should help with webpack

### Risk 3: Network Failures During Upload
**Risk:** Partial uploads on network failure  
**Mitigation:**
- Use multipart upload with S3
- Implement retry logic with exponential backoff
- AsyncTask pattern already supports stop/error handling

### Risk 4: Concurrent Backup Requests
**Risk:** Multiple backups running simultaneously  
**Mitigation:**
- Check `instance.asynchronousTask` before starting
- Use `instance.info.fileLock` pattern

---

## Implementation Ready Checklist

- [x] All patterns verified against codebase
- [x] Type extension points identified
- [x] Router registration method confirmed
- [x] AsyncTask pattern compatible
- [x] Lifecycle hooks verified
- [x] Schedule system extensible
- [ ] Dependencies need to be added (3 packages)
- [ ] Type definitions need updating (3 files)

---

## Recommended Implementation Order

Based on dependency analysis:

1. **Add npm dependencies** (S3, GCS)
2. **Update type definitions** (`global.d.ts`, `InstanceConfig`, `IPresetCommand`)
3. **Create provider interface & implementations** (S3, GCS)
4. **Add global config for providers**
5. **Create BackupService**
6. **Create BackupAsyncTask**
7. **Create BackupCommand** (preset)
8. **Create BackupLifeCycleTask**
9. **Modify FunctionDispatcher**
10. **Modify schedule action enum**
11. **Create daemon routers** (backup_router, provider_router)
12. **Register routers** in router.ts
13. **Create panel proxy routers**
14. **Add i18n strings**

---

## Conclusion

The implementation plan is **fully compatible** with the existing codebase architecture. All integration points have been verified, and the patterns used in the plan match existing patterns exactly.

**Proceed to implementation.**
